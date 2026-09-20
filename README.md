# Force Activate

A GNOME Shell extension that brings a window to the foreground when another
application asks for it, instead of only raising a “Window is ready”
notification.

> [中文说明](README_ZH.md)

---

## The problem

Click a link in WeChat (or any application that shells out to `xdg-open`)
while your browser is minimised: the page loads, but the browser window stays
where it was. GNOME shows a “Window is ready” notification and waits for you
to click it. The same happens the other way round for file managers, mail
clients, and anything else that opens a URI in an already-running program.

This is not a bug in those applications. Under Wayland a client cannot
activate a window it does not own — the compositor only honours the request
when it carries a valid **xdg-activation token**. Applications that open a URI
through `xdg-open` go through GLib's *default* `GAppLaunchContext`, which does
not attach such a token (only GTK's `GdkAppLaunchContext`, or a launch routed
through `org.freedesktop.portal.OpenURI`, does). mutter therefore refuses to
raise the window and merely marks it as demanding attention, which is what
triggers the notification.

Note that routing the launch through the portal is not a workaround:
`g_app_info_launch_default_for_uri()` in GLib launches the application
directly first and only falls back to the portal when that fails, and
`glib_should_use_portal()` returns true only inside a Flatpak sandbox
(`/.flatpak-info`) or when `GTK_USE_PORTAL=1` is set. A running browser is
spawned successfully, so the portal is never consulted.

## How it works

The extension connects to the `window-demands-attention` and
`window-marked-urgent` signals on `global.display` — the same signals GNOME
Shell's own `WindowAttentionHandler` listens to — and calls
`Main.activateWindow()` on the window that asked for attention.

Because GNOME Shell is a trusted client of the compositor, that activation
request is not subject to focus stealing prevention, so the window is raised,
its workspace is switched to, and it receives keyboard focus. Optionally the
extension also blocks GNOME Shell's own handler so the notification banner
never appears.

## Requirements

| | |
|---|---|
| GNOME Shell | 45 or newer |
| Session type | Wayland (X11 sessions do not need this) |
| Build tools | `glib-compile-schemas` (from `libglib2.0-bin`), `gnome-extensions` (shipped with GNOME Shell), `node` + `pnpm`, `python3` |

## Install

### From source

```bash
git clone <your-remote> force-activate
cd force-activate
pnpm install:ext    # copies to ~/.local/share/gnome-shell/extensions/
```

On Wayland a newly installed extension is only picked up after a **new login**:

```bash
# log out and back in, then:
pnpm enable
```

### From a release bundle

```bash
pnpm build
gnome-extensions install --force build/force-activate@edwinhuish.github.io.shell-extension.zip
```

## Settings

Open the preferences from Extensions (or `gnome-extensions prefs
force-activate@edwinhuish.github.io`):

| Setting | Default | Description |
|---|---|---|
| Skip the “Window is ready” notification | on | Blocks GNOME Shell's own attention handler so no banner is shown. Turn off to keep the native notification. |
| Ignore list | empty | WM classes that should never be force-activated, for example `org.telegram.desktop`. Matching windows are left to GNOME Shell. |

Settings live in `org.gnome.shell.extensions.force-activate` and can also be
changed from the command line:

```bash
gsettings --schemadir schemas \
  set org.gnome.shell.extensions.force-activate ignore-list "['org.telegram.desktop']"
```

## Troubleshooting

**The extension does not appear in the list.**
Log out and back in. On Wayland GNOME Shell cannot be restarted in place, so
it only scans the extension directory at startup.

**Windows still do not come forward.**
Check for a competing extension that hooks the same signals — for instance
*Window Is Ready - Notification Remover*, which blocks the signal without
activating anything. Keep only one of them enabled. Look at the Shell log for
errors:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

**A specific application now steals focus too aggressively.**
Add its WM class to the ignore list. You can read the WM class from
`Looking Glass` (`Alt`+`F2`, then `lg`) or from `window.get_wm_class()`.

**Every window in an application complains.**
The extension matches on WM class; a window without one is always activated.

## Development

```bash
pnpm lint          # compile + validate GSettings schema, validate metadata.json
pnpm test          # run the official extensions.gnome.org linter (shexli)
pnpm install:ext   # build and install into the user extension directory
pnpm enable        # enable the extension
pnpm disable       # disable it
pnpm build         # build a bundle for extensions.gnome.org
pnpm release       # lint, bump version-name + package.json version, pack, commit and tag (1.0.0 / minor / major)
pnpm uninstall:ext # remove the installed copy
pnpm clean         # drop build artefacts
```

Layout:

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

`metadata.json` declares `settings-schema` explicitly because a GSettings
schema id must be namespaced under `org.gnome.shell.extensions` and therefore
cannot be the extension uuid.

## Releasing

The offline checks (compile/validate the GSettings schema, validate
`metadata.json`) live in `scripts/lint.mjs` (run via `pnpm lint`), while the
official extensions.gnome.org linter `shexli` is in `scripts/test.mjs` (run via
`pnpm test`). The release helper is `scripts/release.mjs` (modeled on
BetterTrayIcons): it bumps `version-name` in `metadata.json` and `version` in
`package.json`, builds the bundle with `gnome-extensions pack`, commits the
bump and tags it. `pnpm release` runs `pnpm lint` and `pnpm test` first, so a
release is only cut when the `shexli` lint and the bundled checks pass.

```bash
pnpm lint                            # schema + metadata
pnpm test                            # shexli (extensions.gnome.org)
node scripts/release.mjs            # build the bundle for the current version
node scripts/release.mjs 1.1.0      # bump, build, commit and tag v1.1.0
node scripts/release.mjs --dry-run 1.1.0   # show what would happen, change nothing
pnpm release 1.1.0                  # lint + shexli first, then bump/pack/commit/tag
pnpm release --push 1.1.0           # same, and pushes the commit and tag
```

A versioned run always creates the tag v<x.y.z>; pass `SKIP_CHECK=1` to skip the
network-dependent lint when offline.

The bundle is produced by `gnome-extensions pack`, so it ships
`schemas/*.gschema.xml` but not `gschemas.compiled`: the installer (GNOME 44+)
and extensions.gnome.org compile the schema themselves, and a stale compiled
copy would shadow later edits to the XML. After `pnpm release` (or
`node scripts/release.mjs <version>`), upload the bundle at
<https://extensions.gnome.org/upload/> by hand, then push the tag with
`git push --follow-tags`.

The uuid is namespaced (`force-activate@edwinhuish.github.io`), as
extensions.gnome.org requires. Keep it aligned with the uuid of your extension
on extensions.gnome.org, and optionally add a `url` field pointing to the
source repository.

A `ci.yml` workflow under `.github/workflows/` runs `pnpm lint` and `pnpm test`
(the `shexli` and bundled checks) on every pull request and on pushes to `main`,
so format problems are caught before a release is cut.

## Limitations

- The extension disables focus stealing prevention for the windows it handles.
  That is the point, but it also means a badly behaved application can raise
  itself. Use the ignore list to contain that.
- It only reacts to windows that GNOME Shell already flagged as demanding
  attention. If an application opens a window without any attention request,
  there is nothing to react to.
- Tested on GNOME Shell 50 under Wayland.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
