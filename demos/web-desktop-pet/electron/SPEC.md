# Electron Desktop Demo

## Objective

Windows x64 desktop version of the existing Control demo, using the same real
avatar, original TAR inference and canonical Control behavior postprocessing.
Separate transparent always-on-top pet and compact controller. No browser launch
or manually started HTTP server required.

## Scope

- Native draggable transparent pet, captions, size, pin/unpin and hide/show.
- Empty margins pass clicks through. Explicit full click-through mode can be
  disabled from the controller or tray. Tray can restore either window or quit.
- Controller supports editable tagged silent preview and existing fixed speech.
  Hiding/minimizing the controller pauses playback; the pet remains available.
- Closing controller hides it to tray; explicit Exit shuts down both windows,
  owned HTTP server and inference subprocesses. Second launch restores controller.
- Source in `electron/`; shared browser code remains authoritative.
- Produce an unpacked Windows application directory with a double-clickable EXE.
  Bundle Electron, demo, avatar, renderer, Control Java sources and motion library.
  Keep original TAR, Python environments and JDK external, with generated local
  runtime path configuration. Not a signed installer or standalone inference kit.

## Commands

From `control/demos/web-desktop-pet`:

```powershell
npm ci --ignore-scripts
node node_modules/electron/install.js
npm test
npm run desktop
npm run desktop:test
npm run desktop:package
```

Electron is pinned. Install scripts are disabled by default; only the reviewed
Electron binary downloader is run explicitly. No root dependencies are modified.
Manual code uses ES modules and existing uni-icons; sandboxed preload is CommonJS.

## Boundaries And Contract

- Main owns HTTP lifecycle, geometry, tray, permission policy, IPC and exit.
- Preload exposes named methods, never `ipcRenderer`, filesystem or shell access.
- Renderer IPC sender must match the intended window's top-level frame and exact
  local document URL. Expression/caption payloads and numeric options are bounded.
- Shared preview POST schema is unchanged. Desktop server additionally requires
  an ephemeral main-process token, attached only to this session's own origin.
- Block remote network, navigation, new windows, downloads and permissions.
  Node integration off, context isolation and sandbox on. Keep WebGL enabled.
- Temporary Java/audio artifacts use app userData, not the installed app folder.
- No model conversion, production source edits, startup registration or telemetry.
- Local config contains paths only; never bundle secrets, user data or weights.

## Verification

1. Failing then passing geometry, role-based IPC and private-server tests.
2. Existing Node and Python tests plus browser regressions for shared changes.
3. Actual Electron: two windows, sandbox, transparent nonblank animated pixels,
   captions, TAR silent preview, drag, resize, pin, hide/restore, click-through,
   tray restore and shutdown during inference.
4. Inspect controller/pet screenshots, compact layout, keyboard and axe checks.
5. Build and smoke-test the packaged EXE, not only development launch.

## Plan

- [x] Native boundaries, private server and shutdown-safe inference.
- [x] Controller and transparent pet, using existing playback modules.
- [ ] Windows build, real Electron verification and documentation.
