# Device Test Distribution

## Objective

Ship the current device edition to colleagues as a Windows 10/11 x64 installer.
User/reply bubbles and the original caption float over the lower portrait, directly
above a permanent composer card that ends the pet window. Keep the original
controller, QR binding, paired online voices, bracket filtering and actual LAM
inference.

| Capability | Responsibility | Depends on |
| --- | --- | --- |
| below-avatar-chat | Avatar, bubbles, permanent composer in that order | existing device UI |
| device-installer | Independent installed application and bundled inference | below-avatar-chat |

## Contract

- Brand the device edition as `AIBanlv`, with `桌面伴侣` in the UI and window
  titles. Use the color AI icon copied from Control's `static/custom/ic_custom_logo.png`
  as the repository-owned `static/aibanlv-logo.png` for UI, tray and executable.
  Remove the text/action debug panel and its controller/relay wiring. Keep the
  offline text edition separate. Preserve the existing device data directory,
  AppUserModelId and installer ownership markers for existing bindings.
- Use the permanent 92px composer and a default 360px pet width, with a
  300-440px size control and a 240px native minimum. The portrait covers the
  window with device-only zoom; offline editions keep their original framing.
  Fixed lower rows must stay readable and interactive at 240/300/360/440 widths and
  height-clamped work areas. Hidden bubbles do not resize the window. Native
  click-through regions follow the new positions; the composer and visible
  bubbles remain interactive, and the composer cannot be collapsed.
- Expose the existing transparent pet as a taskbar window with the stable title
  `AIBanlv - 桌面伴侣`. Register it through Electron's native taskbar API after
  showing, and restore it if minimized. Retain exactly two windows, not a second
  avatar renderer. Visible capture candidates must not be tool/child/cloaked
  windows or content-protected; OBS capture output/alpha requires target-machine
  verification and is not implied by taskbar presence.
- Reuse Electron Packager and the existing renderer/module paths. Add a dedicated
  device build, leaving previous offline editions and their packaging untouched.
- Bundle a relocatable Python runtime, required existing Python dependencies,
  trusted original LAM source/TAR, a redistributable Java runtime, compiled
  unchanged Control classes, Gson and keyframe library. No system Python,
  Java, Node, Gradle cache or developer drive is required on the target PC.
- Use an explicit packaged runtime root; development defaults remain unchanged.
  No runtime compilation or writes under the install directory.
- Bundle the pinned official Harness modules and private ACP worker as app
  dependencies, including installed optional native bindings and licenses.
  Use Control's own executable in Node mode; no external Harness executable,
  installation discovery, stage directory or runtime downloads.
- Install per-user without admin, create Start Menu/desktop shortcuts and an
  uninstaller. Register autostart by default as the current-user Run value
  `ControlDeviceTest`, targeting the quoted `AIBanlv.exe` path, and delete it
  after successful uninstall; the finish page keeps "Open AIBanlv" checked.
  Do not install services, change PATH or delete
  device identity on uninstall. Retain license notices. Clearly mark the
  unsigned internal test build and the need for internet/account binding.
- Never bundle identities, downloaded customer avatars, credentials, logs,
  caches, local configuration or test profiles. Copy sources using allowlists.
  Preserve unrelated changes and model weights; no source conversion or backend edits.

## Commands And Structure

From `control/demos/web-desktop-pet`:

- `npm test`
- `npm run device:test`
- `npm run device:package`
- `npm run device:installer`
- `$env:DEVICE_EXECUTABLE='<installed AIBanlv.exe>'; npm run device:test`
- `node tests/device-python-package.mjs <staged-runtime>`
- `node tests/device-installer-safety.mjs`
- `node tests/device-installed.mjs`

`electron/device-pet*` and `device.css` own layout and hit regions.
`electron/device-package.mjs` and `device-installer.*` own packaging.
`scripts/package-device-python.mjs` owns the relocatable Python/model stage.
`electron/device-lam-engine.mjs` owns runtime selection.
Generated packages and verification evidence stay in ignored `dist/`/`artifacts/`.
Use existing ES modules, single quotes and explicit shell-free process arguments:

```javascript
createLamEngine(signal, { runtimeRoot: packagedRuntime })
```

## Verification

Write failing layout/path tests first, then run the full Node suite and real
Electron tests. Inspect screenshots, moving/nonblank transparent pixels,
responsive bounds, focus and keyboard input. Package and install into a fresh
path with spaces; verify the installed executable with isolated identity and
local cloud fixtures, bundled actual LAM/Java and a clean dependency environment.
Test uninstall without touching the normal device profile; verify the Run value
is written on install and removed on uninstall, including a retried uninstall.
Record size/hash, installer entry and limitations. No paid production conversations.

This is an internal test distribution, not a production rollout: existing server
authorization/balance risks and live account/phone verification remain documented.

## Build Notes

The Python stage uses a digest-pinned standalone CPython 3.11.17 distribution,
not a relocated development venv. Wheel RECORD hashes and an explicit dependency
closure select 31 installed packages. The original TAR remains unchanged.
An app-local, digest-verified `msvcp140.dll` from the bundled Temurin distribution
completes the native dependency closure; its Microsoft license is retained.
`python-runtime.json` records versions, sizes, hashes and license paths.

NSIS receives an extended-length package path, so a dependency's long source
filename does not fail compilation. The 2026-10-27 differential-update revision
uses per-file zlib compression so unchanged streams can be reused by blockmap
downloads; actual installer size and bandwidth still require release-build measurements.
The installer accepts empty directories and verifies the existing
marker before an in-place reinstall. Failed file deletion preserves the marker,
uninstaller, registry entry and Run value so uninstall can be retried after closing the app.
Unknown files and the normal device profile are never recursively removed.

Before deleting legacy links/executables or extracting any payload, installation
preflights every enumerated destination file plus the branded/legacy EXE,
uninstaller and ownership marker. A native Unicode `OPEN_EXISTING` write probe
does not truncate or create files and immediately closes successful handles.
Locked/inaccessible files show a localized tray-exit/write-permission hint with
Retry/Cancel after a bounded grace period; silent mode exits with code 2 without
changing existing payload or registration. No process killing, ACL changes or
same-name process matching is allowed. Payload extraction disables Ignore, so a
late lock cannot be skipped as a supposedly successful incomplete installation.
This is a preflight, not a transactional installer: a new lock or disk failure
after extraction begins can still require cancelling and retrying the installer.

The safety integration uses a small generated fixture and a real Windows file
lock. Compile-time installation/shortcut identifiers isolate its registry, Run value and
links so it can run without replacing an existing application. Production
defaults keep the legacy ownership marker and registry identity for upgrades;
upgrades remove the old owned executable and replace its named shortcuts.
The installed integration uses the full installer, checks shortcut targets
and installed file sizes, then executes the real Electron flow with developer
Python/Java paths disabled. The full installed integration refuses to replace an
existing registered installation; the safety fixture uses isolated identifiers.
