/* prefs.js
 *
 * Preferences for the Force Activate extension.
 * Force Activate 扩展的首选项界面。
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ForceActivatePreferences extends ExtensionPreferences {
    /**
     * @param {Adw.PreferencesWindow} window - the window to fill in.
     */
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const gettext = this.gettext.bind(this);

        const page = new Adw.PreferencesPage({
            title: gettext('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        page.add(this._buildBehaviourGroup(settings, gettext));
        page.add(this._buildIgnoreListGroup(settings, gettext));

        // Preferences run in their own process that exits with the window, but
        // disconnecting explicitly keeps the handler from outliving the UI.
        //
        // 首选项在独立进程中运行、随窗口退出，显式断开可避免 handler 活过 UI。
        window.connect('close-request', () => {
            this._cleanup?.();
            this._cleanup = null;
            return false;
        });
    }

    _buildBehaviourGroup(settings, gettext) {
        const group = new Adw.PreferencesGroup({
            title: gettext('Behaviour'),
            description: gettext('What happens when an application asks for a window to come forward.'),
        });

        const suppressRow = new Adw.SwitchRow({
            title: gettext('Skip the “Window is ready” notification'),
            subtitle: gettext('Focus the window directly instead of showing a notification banner.'),
        });
        settings.bind('suppress-notification', suppressRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(suppressRow);

        return group;
    }

    _buildIgnoreListGroup(settings, gettext) {
        const group = new Adw.PreferencesGroup({
            title: gettext('Ignore list'),
            description: gettext('Windows whose WM class matches an entry below are left to GNOME Shell.'),
        });

        const rows = new Map();

        const sync = () => {
            const wanted = new Set(settings.get_strv('ignore-list'));

            for (const [wmClass, row] of rows) {
                if (wanted.has(wmClass))
                    continue;

                group.remove(row);
                rows.delete(wmClass);
            }

            for (const wmClass of wanted) {
                if (rows.has(wmClass))
                    continue;

                const row = new Adw.ActionRow({title: wmClass});

                const removeButton = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                    tooltip_text: gettext('Remove from the ignore list'),
                });
                removeButton.connect('clicked', () => {
                    const list = settings.get_strv('ignore-list')
                        .filter((entry) => entry !== wmClass);
                    settings.set_strv('ignore-list', list);
                });

                row.add_suffix(removeButton);
                group.add(row);
                rows.set(wmClass, row);
            }
        };

        const entry = new Adw.EntryRow({
            title: gettext('Add a WM class, for example org.telegram.desktop'),
            show_apply_button: true,
        });
        entry.connect('apply', () => {
            const wmClass = entry.get_text().trim();
            if (wmClass === '')
                return;

            const list = settings.get_strv('ignore-list');
            if (!list.includes(wmClass)) {
                list.push(wmClass);
                settings.set_strv('ignore-list', list);
            }

            entry.set_text('');
        });
        group.add(entry);

        const changedId = settings.connect('changed::ignore-list', sync);
        this._cleanup = () => settings.disconnect(changedId);

        sync();

        return group;
    }
}
