# Force Activate（强制激活）

一个 GNOME Shell 扩展：当别的应用要求把某个窗口提到前台时，直接把该窗口
激活并置顶，而不是只弹一个「窗口已就绪」通知。

> [English README](README.md)

---

## 解决什么问题

浏览器已打开并最小化时，在微信（或任何用 `xdg-open` 打开链接的程序）里点
链接，页面会打开，但窗口不弹到最前，只出一条「窗口已就绪」通知。文件管理器、
邮件客户端等凡是在已运行的程序里打开 URI 的场景，都有同样的现象。

这不是应用的问题。Wayland 下跨应用激活必须携带 **xdg-activation token**，
而 `xdg-open` 走的是 GLib 默认的 `GAppLaunchContext`，不带这个 token
（只有 GTK 的 `GdkAppLaunchContext`，或经由
`org.freedesktop.portal.OpenURI` 的启动才带）。于是 mutter 拒绝提升窗口、
只把它标记为需要关注，这才触发了那条通知。

把启动改走 portal 并不是变通办法：GLib 的
`g_app_info_launch_default_for_uri()` 会先直接启动应用、失败后才回退到
portal，而 `glib_should_use_portal()` 只在 Flatpak 沙箱（`/.flatpak-info`）
内或设置了 `GTK_USE_PORTAL=1` 时才返回 true。浏览器进程本来就启动成功了，
portal 根本不会被用到。

## 工作原理

扩展监听 `global.display` 上的 `window-demands-attention` /
`window-marked-urgent` 两个信号（和 GNOME Shell 自带的
`WindowAttentionHandler` 是同一组），在回调里对请求关注的窗口调用
`Main.activateWindow()`。

GNOME Shell 是 compositor 的可信客户端，它的激活请求不受焦点窃取防护限制，
所以窗口会被提升、工作区会被切换、键盘焦点也会给到该窗口。扩展还可以选择
屏蔽 GNOME Shell 自带的处理器，让通知横幅不再出现。

## 系统要求

| | |
|---|---|
| GNOME Shell | 45 或更新版本 |
| 会话类型 | Wayland（X11 会话不需要此扩展） |
| 构建工具 | `glib-compile-schemas`（来自 `libglib2.0-bin`）、`gnome-extensions`（随 GNOME Shell 提供）、`node` + `pnpm`、`python3` |

## 安装

### 从源码安装

```bash
git clone <your-remote> force-activate
cd force-activate
pnpm install:ext    # 复制到 ~/.local/share/gnome-shell/extensions/
```

Wayland 下新安装的扩展只有在**重新登录**后才会被加载：

```bash
# 注销并重新登录，然后：
pnpm enable
```

### 从发布包安装

```bash
pnpm build
gnome-extensions install --force build/force-activate@edwinhuish.github.io.shell-extension.zip
```

## 设置

在「扩展」中打开首选项（或执行
`gnome-extensions prefs force-activate@edwinhuish.github.io`）：

| 设置项 | 默认值 | 说明 |
|---|---|---|
| 屏蔽「窗口已就绪」通知 | 开启 | 拦截 GNOME Shell 自带的关注处理器，不再显示通知横幅。关闭则保留原生通知。 |
| 忽略列表 | 空 | 永远不强制激活的 WM class，例如 `org.telegram.desktop`。命中的窗口交还给 GNOME Shell 处理。 |

设置保存在 `org.gnome.shell.extensions.force-activate`，也可以用命令行修改：

```bash
gsettings --schemadir schemas \
  set org.gnome.shell.extensions.force-activate ignore-list "['org.telegram.desktop']"
```

## 常见问题

**扩展没有出现在列表里。**
注销并重新登录。Wayland 下 GNOME Shell 无法就地重启，只在启动时扫描扩展目录。

**窗口依然不弹到最前。**
检查是否有别的扩展也接管了同一组信号——例如
*Window Is Ready - Notification Remover*，它只屏蔽信号、不激活窗口。请只保留
其中一个。同时查看 Shell 日志中的报错：

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

**某个应用现在抢焦点太激进。**
把它的 WM class 加入忽略列表。WM class 可以在 `Looking Glass`
（`Alt`+`F2` 后输入 `lg`）里查看，或读取 `window.get_wm_class()`。

**某个应用的每个窗口都被抱怨。**
扩展按 WM class 匹配，取不到 WM class 的窗口总会被激活。

## 开发

```bash
pnpm lint          # 编译并校验 GSettings schema、校验 metadata.json
pnpm test          # 运行 extensions.gnome.org 官方检查工具 shexli
pnpm install:ext   # 构建并安装到用户扩展目录
pnpm enable        # 启用扩展
pnpm disable       # 禁用扩展
pnpm build         # 打包用于 extensions.gnome.org 的压缩包
pnpm release       # 先检查，再改 version-name 与 package.json 版本 + 打包 + 打 tag（1.0.0 / minor / major）
pnpm uninstall:ext # 删除已安装的副本
pnpm clean         # 清理构建产物
```

目录结构：

```
.
├── metadata.json
├── extension.js
├── prefs.js
├── schemas/
│   └── org.gnome.shell.extensions.force-activate.gschema.xml
├── scripts/
│   ├── lint.mjs
│   ├── test.mjs
│   ├── build.mjs
│   └── release.mjs
├── package.json
├── pnpm-lock.yaml
├── README.md
└── README_ZH.md
```

`metadata.json` 显式声明了 `settings-schema`，因为 GSettings 的 schema id
必须以 `org.gnome.shell.extensions` 为前缀，不能直接等于扩展 uuid。

## 发布

离线检查（编译并校验 GSettings schema、校验 `metadata.json`）在 `scripts/lint.mjs`
（通过 `pnpm lint` 运行）中；extensions.gnome.org 官方检查工具 `shexli` 在
`scripts/test.mjs`（通过 `pnpm test` 运行）中。发布辅助脚本是 `scripts/release.mjs`
（参考 BetterTrayIcons 的写法）：它会修改 `metadata.json` 里的 `version-name`
和 `package.json` 里的 `version`，用 `gnome-extensions pack`
打包，提交改动并打上 tag。`pnpm release` 会先跑 `pnpm lint` 和 `pnpm test`，所以只有在
`shexli` 和内置检查通过后才打 tag。

```bash
pnpm lint                            # schema + metadata
pnpm test                            # shexli（extensions.gnome.org）
node scripts/release.mjs            # 用当前版本打包
node scripts/release.mjs 1.1.0      # 改版本号、打包、提交并打 tag v1.1.0
node scripts/release.mjs --dry-run 1.1.0   # 只预览，不做任何改动
pnpm release 1.1.0                  # 先检查，再改版本号/打包/提交/打 tag
pnpm release --push 1.1.0           # 同上，并推送 commit 与 tag
```

给定版本时总会打上 `v<x.y.z>` tag；离线时可传入 `SKIP_CHECK=1`
跳过需要联网的 shexli。

打包使用 `gnome-extensions pack`：包里只有 `schemas/*.gschema.xml`，没有
`gschemas.compiled`——GNOME 44+ 的安装器和 extensions.gnome.org 会自行编译，
而陈旧的编译产物会遮蔽之后对 XML 的修改。执行 `pnpm release`（或
`node scripts/release.mjs <版本>`）后，手动到
<https://extensions.gnome.org/upload/> 上传压缩包，再用 `git push --follow-tags`
推送 tag。

首次上传前：`uuid` 已带命名空间（`force-activate@edwinhuish.github.io`），符合
extensions.gnome.org 的要求。请让它和你在 extensions.gnome.org 上扩展对应的
uuid 保持一致，并可选择加上指向源码仓库的 `url` 字段。

`.github/workflows/ci.yml` 会在每个 PR 和推送到 `main` 时运行 `pnpm lint` 与
`pnpm test`（即 `shexli` 和内置检查），趁早发现问题。

## 限制

- 扩展会为它处理的窗口关闭焦点窃取防护。这正是目的，但也意味着行为不当的
  应用可以自行弹到前台。可用忽略列表来约束。
- 只对 GNOME Shell 已经标记为「需要关注」的窗口起作用。如果应用打开窗口时
  没有发出任何关注请求，就没有可响应的对象。
- 已在 GNOME Shell 50、Wayland 下测试。

## 许可证

GPL-2.0-or-later，见 [LICENSE](LICENSE)。
