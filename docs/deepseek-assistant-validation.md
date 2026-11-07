# DeepSeek Assistant Validation

## 2026-10-22: Applications, Reversible Desktop and Read-only Mail

Current source verification supersedes earlier tool counts. The 2026-10-21
package/installer-related results below are historical; no EXE or installer was
built for this extension.

- Root `npm test`: **326 passed**, zero failures, zero skipped tests.
- Demo `node --test tests/device-mail*.test.mjs`: **15 passed**. Includes real
  ImapFlow against a loopback IMAP server, EXAMINE/BODY.PEEK, unread preservation,
  cancellation/socket close, preset TLS/certificate options, MIME/Chinese text,
  encrypted opt-in settings, exact local-date pagination, source/read tokens,
  large-message refusal and explicit text truncation. Notification tests cover
  baseline, restart deduplication, UIDVALIDITY reset, >1000 arrivals, pause and
  forget. No SMTP or mailbox mutation tools are registered.
- `node tests/device-assistant-embedded.mjs`: real embedded ACP handshake,
  exactly **eleven** tools, authenticated execution and model continuation.
- `node tests/device-assistant-service-embedded.mjs`: app fixture launch,
  native temporary-desktop organization and restart recovery, existing
  folder/text/web behavior, approval/denial, cancellation and cleanup.
- `$env:DEVICE_ASSISTANT_ONLY='1'; npm run device:test`: passed with actual
  source Electron and loopback providers. Covers text/voice handoff, app launch
  seam, preview without writes, full move-list approval/denial, native moves and
  recovery. Mail covers controller-only IPC, memory-only and safeStorage,
  pause/reactivate, confirmed list/read content reaching the model fixture,
  denial before read, local-count notifications without extra model calls,
  credential clearing and removal. All console/network assertions passed.
- Confirmed move modal and mailbox settings screenshots at 320/768/1024/1440
  widths; no horizontal overflow, keyboard deny focus and WCAG AA axe checks
  passed. Visually inspected 320/1440 images. Reports/screenshots live in ignored
  `demos/web-desktop-pet/artifacts/device-electron/assistant-results.json`,
  `assistant-moves-*.png` and `mail-*.png`.
- `npm audit --omit=dev --audit-level=moderate`: **zero vulnerabilities**.
  New MIT dependencies are pinned to ImapFlow 2.8.0 and MailParser 3.12.2 in the
  demo manifest/lockfile; installed with scripts disabled. Dependencies and all
  source modules, including native helper C#, are covered by distribution tests.
- `git diff --check`: passed. Three pre-existing untracked IDE files and sibling
  projects were preserved. Local verification artifacts are excluded from Git.

Independent review found and verified fixes for file identity replacement,
directory junction traversal during create/cleanup, cancellation reconciliation,
attribute changes after approval, shortcut metadata/arguments, localized app
IDs, issued candidate tokens and atomic recovery publication. Native file
identity is validated and movement performed through the same file handle;
target files cannot be replaced. A native smoke test also caught the required
NUL terminator for destination names. Mail review caught local-time IMAP search
semantics and notification backlogs; both have independent regression tests.
No required review findings remain.

Implementation references: [Windows file rename information](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info),
[ImapFlow API](https://imapflow.com/docs/api/imapflow-client/),
[MailParser](https://nodemailer.com/extras/mailparser) and
[Electron notifications](https://www.electronjs.org/docs/latest/api/notification).

Remaining manual acceptance: enter a real QQ/163/126 client authorization code
in the settings UI, validate that provider's connection behavior and actual OS
toast delivery on the target PC, and run explicitly approved real model calls.
The protocol/MIME/UI tests prove local behavior, not real provider login,
production summary quality or Windows toast delivery. Native application launch
was stubbed in tests; no real user application or desktop file was touched.
Outlook/Gmail OAuth, custom IMAP hosts, attachments, broad desktop UI automation
and a full daily activity history are outside this implementation.

## 2026-10-21: Embedded Runtime (Historical)

Date: 2026-10-21. Owner: `demos/web-desktop-pet`. This record covers the
internal-module integration, superseding the earlier external-runtime checks.

## Verified

- `npm test` from `control-windows`: 197 tests passed, no skipped tests,
  including stalled-task cleanup, key-only activation, legacy setting migration,
  environment isolation and rejection when the execution guard is missing.
- `node tests/device-assistant-embedded.mjs`: real embedded Harness ACP handshake,
  exactly five allowed tools, authenticated local execution and continuation.
- `node tests/device-assistant-service-embedded.mjs`: URL/folder/text tools,
  search citations, private-network fetch rejection, approval/denial, session
  reuse, cancellation and private-home cleanup, with no external Harness path.
- `DEVICE_ASSISTANT_ONLY=1 npm run device:test`: real Electron key-only settings,
  memory-only default, opt-in safeStorage, controller-only IPC, text/voice
  handoff, exact-target confirmation seam, denial, cancellation, clearing the
  key, cleanup and layout. Confirms the directory IPC/UI is absent and the
  worker command equals Control's own executable.
- `npm run device:test`: full source Electron regression with actual LAM,
  binding, voice pairing, microphone, original actions, particles, switching,
  restart and credential removal.
- `node --test tests/device-package.test.mjs tests/device-assistant-runtime.test.mjs`:
  copied production dependencies boot a real worker and ACP session from an
  isolated OS temporary directory outside the source tree. Native Koffi loads.
- `npm run device:package`: build passed using the existing Python/Java stage;
  Harness modules and native dependencies are copied automatically. The new
  package contains only `resources/app`, with no `resources/harness` directory
  or separate Harness executable.
- `npm audit --omit=dev --audit-level=moderate`: zero vulnerabilities.
- `DEVICE_EXECUTABLE=<new executable> DEVICE_ASSISTANT_ONLY=1 npm run device:test`:
  packaged assistant passes the same key-only, native-dependency, text/voice,
  confirmation, denial, cancellation and layout checks, with developer runtime
  dependencies disabled.
- `DEVICE_EXECUTABLE=<new executable> npm run device:test`: complete packaged
  regression passed, including actual bundled LAM/Java, binding, microphone,
  original actions, text/voice assistant calls, saved-key restart activation
  and two-window exit cleanup, with developer runtime dependencies disabled.
- `git diff --check`: whitespace check.

Electron reports and screenshots are in the ignored directory
`demos/web-desktop-pet/artifacts/device-electron/`. Full regression uses
`results.json`; assistant-only uses `assistant-results.json`. Screenshots at
320/768/1024/1440 widths were inspected. All tested widths had no horizontal
overflow; keyboard focus, WCAG AA and console/network assertions passed.

New local build:
`demos/web-desktop-pet/dist/device-KQBcn2/ControlDevice-win32-x64/ControlDevice.exe`.

## Fixes Found During Validation

The old external executable/ASAR discovery and staging helper are removed.
Control now boots pinned official Harness `0.2.1-rc.2` modules with a fixed
composition in its own worker. ACP requires the desktop execution guard to be
active; a missing guard prevents session creation. No user profile layers load.

An isolated distribution test exposed missing optional native packages: Koffi
could load in the checkout but failed outside it. The dependency copier now
includes installed optional dependencies and required peers, with a regression
that boots outside the checkout. No native binary downloads occur at runtime.

Harness's transitive MCP client `2.2.0` carried GHSA-6prh-2h8m-c8cw. The app
pins an npm override to `@modelcontextprotocol/client@2.3.0`, the fixed minor
release. No external MCP servers are accepted by Control's ACP client. The
lockfile and isolated boot/loopback tests cover the overridden dependency.

The first packaged full regression timed out at the existing controller
`page.screenshot` call (30 seconds) before assistant checks; the failure capture
then succeeded and no application console errors were collected. The packaged
assistant-only run and an unchanged full rerun both passed. No timeout increase,
test skip, assertion removal or application workaround was introduced. The
underlying intermittent screenshot timing was not established.

## Manual Acceptance

Model, search, realtime provider and billing requests used local fixtures.
No real provider credentials or paid sessions were used. Native dialog and
shell seams were replaced only inside isolated Electron test processes.

Still required before an external release: real user-approved DeepSeek/Qwen
calls and billing, public-page fetch with an actual target, native confirmation
interaction and shell opening on the target PC, plus installer installation,
upgrade and uninstall validation for the new artifact. No installer was
rebuilt for this change.

The build is an unsigned local test directory, not a published release.
Only the pinned embedded module versions are supported. Existing unrelated
IDE files and sibling projects were preserved. No Git commit was made.

Local code review covered the embedded composition, worker shutdown, guard
readiness, key migration, removed IPC and dependency-copy boundaries. No
independent review approval is claimed.
