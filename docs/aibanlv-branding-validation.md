# AIBanlv Branding and Production UI

Verified on 2026-10-21 in `demos/web-desktop-pet`.

## Source-start taskbar icon correction (2026-10-23)

`npm start` launches the device entry through Electron. The two windows now
use `static/aibanlv.ico`, wrapping the unchanged logo PNG, with an explicit
AppUserModelId, icon resource, display name and relaunch command. Source mode
relaunches Electron with the absolute `device-main.mjs` path; packaged mode
relaunches its executable. Source mode uses the separate taskbar identity
`com.zhanlv.control.device.source` to avoid reusing the host/installed group's
cached icon. The packaged app identity and existing user data stay unchanged.
Packaging copies the same ICO rather than generating a separate icon.

Verification: repository-root `npm test` passed 440 tests without skips. The
local Electron fixture also read both real Windows property stores through
`SHGetPropertyStoreForWindow` and verified the AppID, ICO path/index, display
name and source relaunch command. This checks persisted native properties,
not just calls to `setAppDetails`. No EXE/installer was built. Existing running
processes must exit before restarting with `npm start` to load these changes.

Reference: https://learn.microsoft.com/en-us/windows/win32/properties/props-system-appusermodel-relaunchcommand

## Result

- Application/executable name: `AIBanlv` / `AIBanlv.exe`.
- Settings heading: `桌面伴侣`; native window titles:
  `AIBanlv - 桌面伴侣设置` and `AIBanlv - 桌面伴侣`.
- UI, tray and executable icon use `static/aibanlv-logo.png`, an unchanged
  copy of Control's `static/custom/ic_custom_logo.png` (192 x 192).
  SHA-256: `e0462407636164dfd310e3a26b8304050194eeb000ad07368cfe666670e0cbf7`.
- Removed text/action debug controls, their stylesheet rules, script route,
  preload relay, main-process relay and renderer presentation subscription.
  The separate offline text edition keeps its existing implementation.
- Existing data directory, AppUserModelId, installer registry identity and
  ownership marker remain compatible with existing bindings and settings.
  Installer display names/shortcuts target AIBanlv; upgrade handling removes
  the legacy owned executable before installing its replacement.

## Verification

- Repository-root `npm test`: 197 passing tests; no skips.
- `node --test tests/device-package.test.mjs`: three passing tests, including
  the new icon and exclusion of the debug controller from the distribution.
- `DEVICE_ASSISTANT_ONLY=1 npm run device:test`: brand/title/icon loading,
  absent debug UI/relay, a 404 for the removed debug script, plus text/voice
  assistant operations and key storage.
- `npm run device:test`: complete source regression with actual LAM,
  microphone, binding, settings, keyboard/dragging, assistant and restart.
- `npm run device:package`: generated `AIBanlv.exe`; Windows ProductName,
  FileDescription and OriginalFilename match the new brand. The final
  `Readme.txt` was copied from the updated source after the build.
- `DEVICE_EXECUTABLE=<new AIBanlv.exe> npm run device:test`: complete packaged
  regression passed with development runtime dependencies disabled.
- Packaged `DEVICE_GAZE_ONLY=1` and `DEVICE_TOUCH_ONLY=1` runs passed: desktop
  cursor sampling, return-to-neutral, touch priority, hide/switch cleanup,
  nose/cheek prompts, spoken replies, LAM mouth movement, dragging and cancel.
- `node tests/device-installer-safety.mjs`: isolated registry/shortcut IDs,
  branded shortcut targets, legacy executable removal, locked-file uninstall
  failure/retry and preservation of unrelated files all passed. Used the
  existing NSIS compiler after verifying its cached archive checksum.
- `git diff --check`: clean. Reviewed the changed branding, controller
  subscriptions, debug removal and installer ownership/cleanup paths.

Screenshots at 320/768/1024/1440 pixels were inspected; no horizontal overflow
or accessibility/console errors. Evidence is in ignored
`artifacts/device-electron/`. All cloud calls and native dialog/shell actions
used existing local fixtures; no paid provider calls were made.

Local package: `dist/device-9i9w8Z/AIBanlv-win32-x64/AIBanlv.exe`.
No new full installer was built or installed over the existing application.
Unrelated IDE files and sibling projects were preserved; no Git commit.
