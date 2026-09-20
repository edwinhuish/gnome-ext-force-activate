/* extension.js
 *
 * Force Activate — bring windows that another application asked for to the
 * foreground, instead of only raising a "Window is ready" notification.
 *
 * Force Activate —— 让被其它应用拉起的窗口直接获得焦点，
 * 而不是只弹一个「窗口已就绪」通知。
 *
 * Why this is needed / 为什么需要它
 * ---------------------------------
 * Under Wayland a client cannot activate a window it does not own. The
 * compositor only honours the request when it carries a valid xdg-activation
 * token. Applications that open a link through `xdg-open` (GLib's default
 * GAppLaunchContext) do not attach such a token, so mutter refuses to raise
 * the window and only marks it as demanding attention. GNOME Shell then shows
 * the "Window is ready" notification and waits for the user to click it.
 *
 * Wayland 下客户端不能激活不属于自己的窗口，compositor 只在请求携带有效
 * xdg-activation token 时才放行。通过 `xdg-open` 打开链接的应用（用的是
 * GLib 默认的 GAppLaunchContext）不带 token，mutter 于是拒绝提升该窗口，
 * 只把它标记为 demands-attention，GNOME Shell 随之弹出「窗口已就绪」通知。
 *
 * This extension takes over that signal and calls Main.activateWindow(), which
 * goes through the compositor as a trusted client and is therefore not subject
 * to focus stealing prevention.
 *
 * 本扩展接管该信号并调用 Main.activateWindow()，它以 compositor 可信客户端
 * 身份执行，不受焦点窃取防护限制。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * Signals emitted by MetaDisplay when a window asks for attention, typically
 * because the compositor refused to activate it.
 *
 * MetaDisplay 在窗口请求关注时发出的信号，通常因为 compositor 拒绝了激活。
 */
const ATTENTION_SIGNALS = [
    'window-demands-attention',
    'window-marked-urgent',
];

/**
 * Minimum delay between two activations of the same window. If the compositor
 * rejects our request as well the signal fires again immediately — the
 * throttle keeps that from turning into a busy loop.
 *
 * 同一窗口两次激活之间的最小间隔。若 compositor 连我们的请求也拒绝，
 * 信号会立刻再次触发，节流可以避免变成忙循环。
 */
const THROTTLE_MS = 500;

export default class ForceActivateExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._settingsHandlers = [];
        this._shellHandlers = [];
        this._ownHandlers = [];

        this._ignoreList = new Set(this._settings.get_strv('ignore-list'));
        this._lastWindow = null;
        this._lastActivation = 0;
        this._suppress = this._settings.get_boolean('suppress-notification');

        // Block GNOME Shell's built-in attention handler *before* connecting
        // our own: signal_handler_find() returns the first matching handler,
        // and once ours exists it may be the one that gets found.
        //
        // 必须在连接自己的 handler 之前屏蔽 Shell 自带的处理器：
        // signal_handler_find() 返回第一个匹配项，一旦我们自己的存在就可能被找到。
        if (this._suppress)
            this._blockShellHandlers();

        for (const signalId of ATTENTION_SIGNALS) {
            this._ownHandlers.push(
                global.display.connect(signalId, (_display, window) => {
                    this._onAttentionRequest(window);
                })
            );
        }

        this._settingsHandlers.push(
            this._settings.connect('changed::suppress-notification', () => {
                const suppress = this._settings.get_boolean('suppress-notification');
                if (suppress === this._suppress)
                    return;

                this._suppress = suppress;
                if (suppress)
                    this._blockShellHandlers();
                else
                    this._unblockShellHandlers();
            }),
            this._settings.connect('changed::ignore-list', () => {
                this._ignoreList = new Set(this._settings.get_strv('ignore-list'));
            })
        );
    }

    disable() {
        this._unblockShellHandlers();

        for (const handlerId of this._ownHandlers)
            global.display.disconnect(handlerId);
        this._ownHandlers = [];

        for (const handlerId of this._settingsHandlers)
            this._settings.disconnect(handlerId);
        this._settingsHandlers = [];

        this._settings = null;
        this._ignoreList = null;
        this._lastWindow = null;
        this._lastActivation = 0;
        this._suppress = false;
    }

    /**
     * Block the handlers GNOME Shell itself registered for the attention
     * signals, so its notification banner stays out of the way.
     *
     * 屏蔽 GNOME Shell 自己为这些信号注册的处理器，让它的通知横幅不再出现。
     */
    _blockShellHandlers() {
        if (this._shellHandlers.length > 0)
            return;

        for (const signalId of ATTENTION_SIGNALS) {
            const handlerId = GObject.signal_handler_find(global.display, {signalId});
            if (!handlerId)
                continue;

            GObject.signal_handler_block(global.display, handlerId);
            this._shellHandlers.push(handlerId);
        }
    }

    /**
     * Undo _blockShellHandlers(). The handler may already be gone if another
     * extension disconnected it in the meantime, which is not an error.
     *
     * 撤销 _blockShellHandlers()。若期间被别的扩展断开，这里不算错误。
     */
    _unblockShellHandlers() {
        for (const handlerId of this._shellHandlers) {
            try {
                GObject.signal_handler_unblock(global.display, handlerId);
            } catch (e) {
                logError(e, 'force-activate: could not unblock an attention handler');
            }
        }

        this._shellHandlers = [];
    }

    /**
     * @param {Meta.Window} window - the window asking for attention.
     */
    _onAttentionRequest(window) {
        if (!window || window.has_focus() || window.is_skip_taskbar())
            return;

        const wmClass = window.get_wm_class();
        if (wmClass && this._ignoreList.has(wmClass))
            return;

        const now = Date.now();
        if (window === this._lastWindow && now - this._lastActivation < THROTTLE_MS)
            return;

        this._lastWindow = window;
        this._lastActivation = now;

        // activateWindow() raises the window, switches to its workspace and
        // hands it keyboard focus.
        //
        // activateWindow() 会提升窗口、切到它所在的工作区并交出键盘焦点。
        Main.activateWindow(window, global.get_current_time());
    }
}
