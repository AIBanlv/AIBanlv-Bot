# Tasks

## Account Login (2026-10-22)

- [x] Continue the user-approved login spec and verify existing protocol tests.
- [x] Connect main/preload IPC with exact controller checks and cancellation.
- [x] Add QR/password choice, keyboard submit, pending/error states and package allowlists.
- [x] Guard empty response aliases, unrelated device errors and large account snapshots.
- [x] Verify cancellation before/after dispatch without pretending to roll back server binding.
- [x] Complete final Electron regression, independent review and verification record.

Focused login/channel/module checks: 32/32 passed. After remote integration,
login/view/session/realtime checks: 78/78 passed; root `npm test`: 385/385
passed, none skipped; full `npm run test:device` passed. The earlier runtime
dependency audit found no known vulnerabilities; dependencies are unchanged.
The Electron suite uses localhost services, isolated device data and synthetic
microphone input; actual account login and production billing are not exercised.

## Pet Taskbar And Capture Selection (2026-10-19)

- [x] Reproduce missing native taskbar registration and inspect capture eligibility.
- [x] Show the existing transparent pet in the taskbar, retaining its stable title and two-window layout.
- [x] Restore taskbar-minimized pets when shown; verify real native flags, transparency and existing interactions.
- [x] Rebuild and restart the local device, preserving identity; document OBS selection and verification limits.

### Taskbar Verification

- Kept the existing two windows and stable pet title. Changed `skipTaskbar` to
  false, restored minimized pets before showing, and explicitly called
  `setSkipTaskbar(false)` after show. No renderer, audio, binding or layout changes.
- Corrected an initial test assumption: Electron uses `ITaskbarList::AddTab` /
  `DeleteTab`, not `WS_EX_APPWINDOW`, for taskbar registration. The replacement
  regression failed with no registration request, then passed with the native
  method delegated normally. Native inspection still independently verifies
  visible, non-minimized, non-cloaked, non-tool and non-child capture candidates.
- `npm test`: 124/124 passed, none skipped. Source `npm run device:test` and
  packaged `DEVICE_EXECUTABLE=... npm run device:test` passed, including taskbar
  registration after hide/show, minimize/restore, actual transparent moving
  renderer, binding/voice fixtures, real bundled LAM, chat and responsive checks.
  Existing module-type/deprecated-API warnings remain unchanged.
- `npm run device:package` and `npm run device:installer` succeeded for 0.1.2.
  Installer: `dist/ControlDevice-0.1.2-win-x64-Setup.exe`, 710789489 bytes.
  SHA-256: `249057fac07712d0b684a08ca2731cfa3f8cc9b4d8e920aaa86cdbd9fed6c6ab`.
  Unsigned internal test build. Installer logic is unchanged; this version was
  tested as a packaged app, without repeating the full install/uninstall cycle.
- Started the normal build at `dist/device-8OBgBL/ControlDevice-win32-x64`
  as PID 22272. Identity hash unchanged, both windows present, controller bound
  and avatar ready, stderr empty. The earlier generic server rejection remains.
  No OBS scene/settings, production chat, security settings or system runtimes
  were changed. OBS capture output and alpha remain target-machine checks.

## Expression And Pose Continuity Fix (2026-10-19)

- [x] Reproduce lost raw reply metadata and forced zero-pose ownership.
- [x] Reuse native behavior parsing and preserve Control state across turns.
- [x] Smooth device-only rig ownership changes; retain audio-clock articulation.
- [x] Real renderer neutral/surprised comparison, multi-turn continuity and regressions.
- [x] Review, rebuild test package and restart the user's device with identity intact.

### Expression Verification

- Native Java parity: 11 scenarios and 30 real RPC requests passed, including
  explicit/Chinese surprise, raw performance tags, user motion precedence,
  streaming snapshots, persistent RNG/timeline and empty/partial/interrupted turns.
- Original TAR inference passed with unchanged checkpoint, 90 frames and varying
  mouth channels; warm blocks took 206/197/187 ms on this machine.
- Review found a final-snapshot race during reply acknowledgement. A regression
  first failed with the incomplete tag, then passed after rechecking the latest
  version before processing. Cancellation during acknowledgement is also covered.
- Device-only ownership interpolation uses the visible rig pose; unit checks
  cover both transitions, interrupted transitions and unchanged steady speech.
- No new dependency, native algorithm, cloud provider or model changes.
- Final `npm test`: 124/124 passed, none skipped. `npm run device:test` passed
  with real Electron, original TAR, Java and local cloud fixtures. Runtime
  `npm audit --omit=dev --json` has zero findings. Existing shared module-type
  and Java deprecated-API warnings remain visible and unchanged.
- `npm run device:package`, `npm run device:installer` and
  `node tests/device-installed.mjs` passed. Fresh installation verified 7497
  files, shortcuts/registry, bundled-only Python/Java, actual LAM/Electron,
  preserved identity and unrelated files, and complete uninstall.
- Installed renderer comparison: neutral/surprised peak browInnerUp
  0.1825/0.7074, browOuterUpLeft 0.00046/0.6164, eyeWideLeft 0.4925/0.7493.
  Six ownership handoffs; maximum measured transition step 0.00539 radians.
  Screenshots inspected, transparent moving canvas and responsive checks passed.
- Version 0.1.1 installer: `dist/ControlDevice-0.1.1-win-x64-Setup.exe`,
  710789609 bytes (677.9 MiB), installed payload 1425060870 bytes.
  SHA-256: `6df551ee2345261e0cd17f8f380e17bfc19f4d312ee1f478474571f7d8ed6a1e`.
  Authenticode remains NotSigned; original 0.1.0 build is retained for rollback.
- Normal 0.1.1 app started from `dist/device-NrWnoE/ControlDevice-win32-x64`
  as PID 15972. Device identity hash unchanged; both windows opened, controller
  showed bound/role-ready and stderr was empty. A pre-existing generic Control
  server rejection is still visible; its source was not changed or hidden.
  No paid production conversation was sent; live phone/account speech still
  requires user verification.

## Device Test Distribution (2026-10-19)

- [x] Below-avatar chat: stable layout, hit regions, unit/Electron regressions.
- [x] Relocatable Python/model and Java/Control runtime; real inference checks.
- [x] Dedicated allowlisted device package, runtime selection and package tests.
- [x] Per-user installer, fresh install/uninstall and installed Electron checks.
- [x] Review, screenshots, usage notes, final installer path/size/SHA-256.

### Distribution Verification

- Final `npm test`: 118/118 passed, none skipped. JavaScript syntax checks:
  71 files passed. Runtime Node audit: zero findings. Existing development-only
  module-type and unchanged Java deprecated-API warnings are not suppressed.
- `node tests/device-python-package.mjs .../device-python-complete/runtime`:
  relocated Python 3.11.17 with 31 dependencies, clean environment, no external
  Python modules/CRT DLLs and denied network passed real original-TAR A/B/A.
  Startup 6623 ms; blocks 143/149/142 ms; repeated input identical.
  Initial check caught a system MSVC dependency, fixed with app-local runtime
  plus license, then the same integration passed.
- `npm run device:package` and `npm run device:installer` succeeded. The source
  path MAX_PATH failure was fixed with an extended-length compiler input path.
  Package contains 7496 files, includes dependency licenses/provenance and no
  identity, local config, private keys, downloaded avatars or bytecode. The only
  PEM file is certifi's public CA bundle. Node dependencies were not changed.
- `node tests/device-installer-safety.mjs` reproduced an empty-directory failure,
  then a locked-file false success before fixes. Final run passes empty install,
  failed-uninstall maintenance preservation, retry and unrelated-file survival.
  Independent review found no further blocking issues after those fixes.
- `node tests/device-installed.mjs`: full setup installed into a fresh empty
  path with spaces; all package file sizes and executable hash matched.
  Desktop/Start Menu shortcuts and per-user uninstall registry verified.
  Actual installed Electron passed with developer Python/Java/compiler paths
  disabled: real LAM/Control/audio, QR/binding fixture, CosyVoice pairing, bubbles,
  bracket filtering, stop/switch, original controls and clean exit.
- Installed screenshots inspected at pet widths 240/300/380 and controller
  widths 320/768/1024/1440; layout, nonblank/moving/transparent canvas and
  WCAG AA checks passed. Bubbles are below the avatar and above the composer.
  Uninstall removed the application and registration, preserved a sentinel file
  and left the normal device identity unchanged. Test processes exited.
- Output: `dist/ControlDevice-0.1.0-win-x64-Setup.exe`,
  710788977 bytes (677.9 MiB); installed payload 1425055038 bytes.
  SHA-256: `046dbd3f6503539fb30846dc7a5f81589ff709850321058486a43ea09e729010`.
  Matching `.sha256` and `dist/device-installer.json` generated; Authenticode
  status is `NotSigned`. Colleague instructions are installed as `Readme.txt`.
- Internal test build only. No paid cloud conversation or real phone/account
  binding was performed; colleagues must verify their hardware, network and
  authorized test account. No native/backend edits, model conversion, system
  runtime install, identity reset or commit. Original device process not stopped.

## Reply Bracket Filtering (2026-10-19)

- [x] Add assistant-only display filtering for bracket contents, nested tags,
  incomplete streamed tails and stray closing brackets. Preserve raw provider
  text, user bubbles, speech and LAM input.
- [x] Reproduce three failures before the fix; `npm test` now passes 106/106.
  Tests cover final-text corrections clearing stale bubbles and independent turns.
- [x] `npm run device:test`: real Electron bracket filtering, safe text rendering,
  Realtime/LAM playback, controls, responsive layout and WCAG AA passed.
  Screenshot inspected; no renderer errors/warnings. Reviewed assistant-only
  scope, linear bounded parsing and stale-bubble removal.
- Existing device process was not interrupted; restart it to load the new
  renderer module. No production conversation, native/backend edit or dependency.

## Device LAM (2026-10-19)

- [x] Original TAR worker: bounded PCM, warm model reuse, real inference and
  Python tests (`scripts/device_lam_worker.py`, worker tests).
- [x] Control worker: unchanged timeline, canonical channels, cross-block state,
  bounded subprocess RPC and real Java verification.
- [x] Realtime integration: block/partial handling, ordered audio+expression,
  startup/stop/context ownership and error tests.
- [x] Playback: audio-clock interpolation, volume-independent full face,
  closing/stop/underrun tests; retain pet/controller layout.
- [x] Actual-model and Electron verification, review, documentation and restart.

### LAM Verification

- `npm test`: 103/103 passed, no skipped tests. New coverage includes audio-clock
  interpolation, volume independence, partial PCM, ordered expression/audio,
  stop/context invalidation and preparation before session/provider submission.
- `F:/zhanlvAndroidSdk/.venv-lam-coreml/Scripts/python.exe -B -m unittest discover
  -s tests -p test_device_lam_worker.py -v`: 17/17 passed.
  `node tests/device-lam-python.mjs`: real original-TAR A/B/A inference passed;
  repeated A frames are identical and different speech changes the output.
- `node tests/device-lam-inference.mjs`: original TAR plus unchanged Control
  pipeline, three seconds / 90 frames and silence comparison passed. Latest
  startup 4396 ms; one-second blocks 154/134/136 ms. Jaw, pucker, funnel,
  closure and upper/lower lip channels vary with known local speech.
  Killing the owned Python worker correctly blocks the next preparation.
- Java `ControlLamStreamTest` compiled and passed; every canonical channel over
  two blocks matches a directly invoked production timeline. Partial blocks,
  dimensions and closing are covered. Native algorithms and weights unchanged.
- Review fixes have failing-then-passing regressions: cached Python death before
  or during Control reset, old startup clearing newer ownership, shutdown
  awaiting cancelled startup cleanup, and no new startup after device shutdown.
- Final independent review found no further blockers; its focused engine and
  lifecycle tests passed 7/7.
- `npm run device:test`: passed after the final cleanup fix, with real LAM,
  Control and Electron and only cloud transports substituted. Captured 13
  controlled-mouth samples during playback. CosyVoice pairing, bubbles,
  audio clock, volume, stop, role changes, original controls and exit passed.
  Controller widths 320/768/1024/1440 and pet widths 240/300/380 passed
  responsive, transparent/nonblank/moving-pixel and WCAG AA checks.
  Screenshots inspected; no renderer warnings/errors.
- `node --check`: 66 ES modules passed. Existing Node module-type warning for
  Control's `utils/voicePairs.js` remains; no shared package change or suppression.
- Test Python/Java processes exited. Normal device app launched with the
  `npm run device` entry, PID 17416; existing device identity SHA-256 unchanged.
  Startup log contains only the existing module-type warning. No profile reset.
- No paid production conversation, dependency install, model download/conversion,
  native/backend change or commit. Actual-account cloud speech and phone binding
  remain manual integration checks.

## Realtime Voice Mapping Fix (2026-10-19)

- [x] Reproduce CosyVoice rejection and cover original/opaque IDs, ownership,
  ambiguity, metadata failure and cancellation.
- [x] Reuse canonical Control pairing before bootstrap without mutating profiles.
- [x] Verify mapped voice in isolated Electron; run regressions and review.

### Voice Mapping Verification

- Root cause: desktop bootstrap rejected CosyVoice before running Control's
  existing paired-voice lookup. Original alias regression failed with the exact
  reported message, then passed with scoped metadata and canonical pairing.
- `npm test`: 88/88 passed, no skipped tests; session coverage is 14/14.
  Independent review found cross-scope duplicate alias selection; its new test
  failed before the fix, passed afterward, and final review found no blockers.
- `node tests/voicePairs.test.cjs` and
  `node tests/conversationVoiceMapping.test.cjs` from Control root passed.
- `npm run device:test`: passed again after the final ambiguity fix. App sent a
  CosyVoice ID, session request used the paired database ID, provider used its
  native Realtime ID, and controller retained the original ID. Real Electron
  bubbles, nonzero PCM/audio clock, stop, switching and original controls passed.
  Responsive screenshots, moving transparent pixels and WCAG AA passed with
  no renderer errors/warnings. Main emits Node's module-type detection warning
  for Control's existing typeless package; no shared package change/suppression.
- Changed JavaScript syntax and whitespace checks passed. No new dependencies,
  backend changes, unrelated edits or commit.
- Public metadata GET only: production returned HTTP 200 / code 200 and stored
  voice rows. No provider/session minting or paid production conversation was
  performed. Real account voice pairing and cloud speech remain user verification.
- Restarted only the original device app; new PID 25080 remained running.
  Device identity file SHA-256 was unchanged. No installation data was deleted.
- Existing backend risk: stored voice lookup validates tenantId presence but
  lacks caller ownership enforcement under the current permissive security
  configuration. Client scope checks are not server authorization. This needs
  backend hardening before production rollout, outside this desktop fix.

## Realtime Bubbles (2026-10-19)

- [x] Session bootstrap: bound-device subject, exact voice, expiring credentials,
  allowlisted provider endpoint; focused session tests.
- [x] Realtime/billing: registration, text/transcript/PCM, deduplicated usage,
  stop/failure/timeout/context invalidation; focused transport tests.
- [x] Desktop integration: narrow IPC and real audio, private context cleanup,
  original-action mutual exclusion; unit and Electron fixture tests.
- [x] Bubbles: bounded user/reply display, under-avatar input, pending/stop/volume,
  IME/draft/focus, long text and responsive screenshots.
- [x] Regression/review: full Node suite, isolated Electron checks, review fixes,
  usage docs and normal app restart.

### Realtime Verification

- `npm test`: 79/79 passed, no skipped tests. New session, billing, Realtime,
  PCM audio and composer lifecycle tests had initial failing runs before fixes.
- `npm run device:test`: passed after final cancellation-drain fix. Isolated
  Electron used local bootstrap/billing/provider fixtures and the real renderer.
  Verified actual nonzero PCM buffers and advancing Web Audio clock, volume gain,
  user/reply bubbles and HTML escaping, stop, role/voice switch, billing usage,
  long-text scrolling and containment, plus all original device/window tests.
- Controller screenshots at 320/768/1024/1440 and transparent pet screenshots at
  240/300/380 inspected; no overlap with avatar or under-avatar input. Real canvas
  alpha/nonblank/moving pixels passed. WCAG AA checks passed; no page errors or
  renderer warnings. Physical OS mouse-through remains a manual check.
- `node --check`: all 25 device JavaScript files passed (final Realtime change
  was also parsed by subsequent unit and Electron runs).
- `npm audit --omit=dev --ignore-scripts`: zero runtime dependency findings.
  No new dependencies, backend/native edits, unrelated changes or commit.
- Independent review regression fixed: a duplicate completion from a previous
  response cannot prematurely finish the current response's cancellation drain.
  Other red-to-green fixes cover stop during audio preparation, idle draft
  retention, focus restoration, and usage after late response creation.
- Normal device app launched with `npm run device` equivalent, PID 4348.
  No real binding, provider bootstrap, paid conversation or production debit
  was performed by automated tests.
- Existing backend risk (outside this demo): local
  `DigitalHumanSessionService.create` checks balance for anonymous sessions but
  not bound devices. Producer readiness/ACK does not prove sufficient credit
  or completed debit. Backend balance enforcement and real account/phone/cloud
  integration remain required before production rollout.

## Device Desktop Pet Revision (2026-10-19)

- [x] Restore separate control panel and transparent draggable pet.
- [x] Retain text/actions, window settings, tray and binding/role controls.
- [x] Add under-avatar composer with IME, draft retention and honest errors.
- [x] Verify two-window UI, input hit regions, role changes and cleanup.
- [x] Real text conversation: integrate chosen provider and existing billing.
  - Implemented by the Realtime revision above; live account verification remains manual.

### Desktop Pet Revision Verification

- `npm test`: 46/46 Node tests passed. Added pet size, composer hit-region and
  invalid/unbound/unready chat boundary tests, with the initial failing run.
- `npm run device:test`: two isolated native windows, QR/binding/avatar/voice
  regressions, original text actions and actual pose, under-avatar composer,
  Shift+Enter, Chinese composition protection, error/draft retention and focus,
  role/unbind draft reset, pin/visibility/size, keyboard/pointer drag, controller
  close-to-tray/reopen, explicit exit and temporary asset cleanup passed.
- Controller screenshots at 320/768/1024/1440 and transparent pet screenshots
  at 240/300/380 inspected. Nonblank/transparent/moving canvas pixels and
  WCAG AA checks passed; no renderer warnings/errors or external requests.
- Native mouse-through is covered by pure hit-region tests; automated text
  entry uses Playwright/CDP and is not a physical OS pointer test.
- Independent review fixes reproduced red then verified green: actual-height
  hit testing on a 380x600 clamped pet; restoring the currently applied role
  in the selector after a failed cached-role download.
- Syntax checks passed for main, window module and pet renderer.
- No conversation provider requests, temporary-key minting, billing events
  or real AI replies were executed. Existing session-bootstrap source can
  authorize a bound device, but its engine/billing integration remains pending.
- Existing offline desktop/main, text-controller, pet and policy sources are
  reused without edits; no new dependency or backend/native source change.

## Device Edition (2026-10-19)

- [x] Binding: persistent device ID, server QR, expiry, reconnect, unbind gate.
  - Verify: `node --test tests/device-channel.test.mjs`.
- [x] Avatar: download validation, actual renderer readiness, voice/profile sync.
  - Verify: asset tests and `npm run device:test`.
- [x] Online speech: use delivered voiceId, cancel stale audio, volume/stop.
  - Implemented by the Realtime revision above; incompatible voices fail explicitly.
- [x] Runtime/review: existing Node regression, Electron screenshots/pixels,
  responsive layout, real server handshake and usage documentation.

### Device Verification

- `npm test`: 42/42 passed; no skipped tests. `node --check` passed for
  `electron/device-main.mjs` and `electron/device-view.mjs`.
- `npm run device:test`: actual Electron, isolated profile and local WebSocket
  fixture; server QR decoded; unbound/other-device gates; applied acknowledgements;
  role switching with corresponding online voice IDs; failed asset retention;
  unbind cleanup; speech-unconfigured error with original request ID; normal
  window closure removes the temporary avatar directory.
- Actual renderer canvas: transparent, nonblank, animated and contained at
  320/768/1024/1440. Screenshots inspected; WCAG 2.1 AA automated checks passed.
  No renderer console warnings/errors or external renderer HTTP requests.
- `node tests/device-handshake.mjs`: default production WSS service returned
  a valid unbound offer. No test controller/account or binding was created;
  tokens were not logged. This does not verify phone scanning or cloud speech.
- Existing `node tests/browser.mjs`, `node tests/speech-browser.mjs`, and
  `node tests/control-browser.mjs` passed against local port 5178 (the last
  command used `DEMO_URL=http://127.0.0.1:5178/`). They cover the shared avatar
  entry and semantic-label change, including real audio, expressions and pose.
- Independent review findings fixed with red-to-green regressions:
  owner/tenant filtering, newer-version ordering, partial-file cleanup,
  same-controller tenant rebinding, and destroyed-window cleanup.
  Disconnect/reapply behavior is also covered.
- Fixture roles A/B use the same real Benny ZIP under different role metadata.
  Different customer models and a real phone-to-desktop binding remain manual
  integration checks. No claim of audible cloud speech: provider/auth unresolved.
- Source-only device entry; no new standalone package, native/backend edits,
  commit or deployment. Existing offline editions remain available.
- Launched the normal `Control Device` profile against the default service;
  native window title is `Control 设备`, startup logs are empty. The temporary
  web-regression server was stopped after verification.
- An isolated review profile remains at
  `%TEMP%\control-device-review-close-75e310d9-62a0-44a2-8247-7cef6b6b3953`;
  the environment denied its recursive deletion even after path validation.
  This contains test data, not a real account binding. Normal-close cleanup
  after the fix is verified separately above.

## Tagged Silent Preview

- [x] Local Mandarin PCM and original TAR arbitrary-text inference.
- [x] Canonical Control tag parsing and custom action timeline.
- [x] Same-origin bounded API, single job, timeout and cancellation.
- [x] Editable silent preview, pause/stop and source mutual exclusion.
- [x] Browser/API regression, screenshots and documentation.

### Silent Preview Verification

- `npm test`: 15 passed, including same-origin/JSON/body limits, single job,
  disconnected-client cancellation, sanitized dependency errors and retry.
- `F:/Miniconda/python.exe -m unittest discover -s tests -p test_*.py`:
  4 passed, including real Mandarin PCM retrieval without playback.
- `node scripts/prepare-control.mjs --test`: unchanged production numeric parity
  and canonical/Chinese tag parsing, stripping and rejection passed.
- Actual original TAR: checkpoint SHA-256 remains
  `38084d471966381f2e52d9f59e5654c9b8cde6fa36d4c6f18fc02cbaf593d157`.
  Short Mandarin sentence: 3.078 seconds, raw jawOpen range 0.006-0.500,
  processed yaw range -0.255 to 0.300. No ONNX or external TTS.
- `node tests/preview-inference.mjs`: long sentence generated 2 captions,
  13.699 seconds and 411 frames; success/error/actual process-abort cleanup passed.
- `node tests/preview-browser.mjs`: real original-TAR regeneration for two texts,
  changing rendered mouth and head/neck pose, pause/resume/end/closure/replay,
  collapse, editing and pending-response cancellation passed.
  Zero media play / speechSynthesis calls, WAV requests or external requests.
- New regression first reproduced and then fixed: toggling captions after
  completion must not resurrect the first sentence.
- Preview screenshots/pixel checks at 320/768/1024/1440: real avatar nonblank,
  alpha preserved, animation changes, controls and subtitle do not overlap.
  Automated WCAG 2.1 AA passed; no page exceptions or console warnings.
- `node tests/browser.mjs`, `node tests/speech-browser.mjs`,
  `node tests/control-browser.mjs` with `DEMO_URL=http://127.0.0.1:5179/`:
  existing drag/touch/keyboard/resize/captions/audio and Control A/B regressions passed.
- Syntax checks for all demo `src/`, `scripts/`, `tests/` MJS files passed.
  Existing root Windows/xcode-select limitation remains unchanged; no native build.
- Reviewed boundary validation, shell-free subprocesses, temporary cleanup,
  action ownership and stale playback. No production/native sources, dependency
  installations, model conversions or unrelated user files changed.
- Local service PID 31112, `http://127.0.0.1:5179/`; no commit or deployment.

## Control Postprocessing

- [x] Generate tracks using the actual Control Java pipeline; verify parity.
- [x] Add validated named tracks, A/B toggle and production pose adapter.
- [x] Verify playback lifecycle, errors, mobile UI and rendered pose/pixels.
- [x] Record reproducible commands, source hashes and demo limitations.

### Postprocessing Verification

- `node scripts/prepare-control.mjs`: compiles unchanged Control Java sources,
  runs numeric parity test, writes four 398-frame tracks plus 30-frame closures.
  Original raw JSON and TAR remain unchanged. Generated bank approximately 1 MB.
- Numeric parity: 90 x 52 exact values and exact pitch versus a direct Control
  timeline; verifies original inputs remain unchanged. Source fingerprints in bank.
- `npm test`: 12 tests passed (validation, sampling, original behavior and allowlist).
- `node --check` for server and every `src/*.mjs`: passed.
- `node --test test/presentation-pose.test.js test/native-presentation.test.js`
  from the existing renderer project: 15 tests passed, including duplicate gain
  prevention, bind-relative pose, ownership release and native blink handling.
- `node tests/browser.mjs`, `node tests/speech-browser.mjs`,
  `node tests/control-browser.mjs`: passed on local port 5179.
- Actual renderer diagnostics: head, neckLower and neckUpper controlled,
  mixer hook and pose applied; depth applied. Desktop and mobile canvas alpha,
  nonblank pixels and ongoing animation checked; screenshots visually inspected.
- A/B keeps audio time; pause clears articulation; normal end runs Control closure.
  Missing/stale-hash data blocks processing with retry; explicit raw mode works.
- Original drag/touch/keyboard, 320/768/1024/1440 and landscape, captions, retry,
  media lifecycle and automated WCAG 2.1 AA regression passed.
- No normal-path browser warnings/errors or external HTTP requests.
  Java compiler reports the existing captured-library deprecated API usage.
- Only demo files changed; no dependency download, native build, production edit,
  model conversion, commit or deployment. Live server PID 29564 at
  `http://127.0.0.1:5179/`.

## Speech Extension

- [x] Generate offline voice and real original-TAR expression frames.
- [x] Test and implement validated audio-time sampling and manual presets.
- [x] Wire speech controls, synchronized captions and lifecycle reset.
- [x] Verify browser audio, expression pixels, responsive layout and failures.
- [x] Document reproduction and distinguish precomputed inference from presets.

## Initial Demo

- [x] Model rendering: original ZIP, transparent canvas, load/error/retry states.
  - Files: server.mjs, package.json, avatar.html, src/avatar.mjs, tests/server.test.mjs.
  - Verify: Node serving tests and real browser avatar/alpha inspection.
- [x] Pet interactions: bounded mouse/touch drag, caption playback, collapse/reset.
  - Files: index.html, src/host.mjs, src/state.mjs, src/style.css, tests/state.test.mjs.
  - Verify: failing-then-passing Node tests; browser keyboard and pointer flows.
- [x] Checkpoint: no external requests or microphone access; no native changes.
- [x] Responsive QA and documentation.
  - Files: tests/browser.mjs, README.md, tasks/todo.md.
  - Verify: 320/768/1024/1440 screenshots, canvas pixels, animation and console.

## Initial Verification Record

- `npm test` in this directory: 6 tests passed.
- `node --check src/host.mjs` and `node --check src/avatar.mjs`: passed.
- `node tests/browser.mjs`: Edge/Playwright, real original avatar ZIP; transparent
  and nonblank pixels, ongoing animation, desktop/touch/keyboard interactions,
  caption playback and escaping, long text, fixed scroll position, 404/retry,
  320/768/1024/1440 widths and 568x320 landscape verified.
- axe-core WCAG 2.1 AA automated checks: no violations.
- Normal browser path: no warnings, errors or external HTTP requests.
- Expected 404 branch records only the deliberately missing asset and loader error.
- Control root `npm test`: pretest and tests preceding JEV passed; blocked by the
  existing macOS-only `xcode-select` dependency in `jevExpressionDirector.test.cjs`.
- Remaining JS checks run individually: `jevBackendProxy.test.cjs` plus
  `cloudflareWorker.test.mjs`, `h5ApiProxy.test.js`, `jwtRequest.test.js`,
  `h5RuntimeCompatibility.test.js`, `h5DeploymentGuard.test.js`,
  `h5QrScanner.test.mjs` all passed.
- No build needed for this plain ES-module demo. No native/production sources
  changed. The original ZIP is read in place, no TAR/ONNX inference runs.
- Original plan/spec moved into this demo folder. No Git commit or deployment.
- Local-only service left running at `http://127.0.0.1:5178/`.

## Speech Verification Record

- `powershell -NoProfile -File scripts/prepare-speech.ps1`: completed with
  original `LAM_audio2exp_streaming.tar`, strict state loading and no ONNX.
- Original TAR SHA-256:
  `38084d471966381f2e52d9f59e5654c9b8cde6fa36d4c6f18fc02cbaf593d157`.
- Audio: 13.25 seconds, 16 kHz mono, nonzero PCM (peak 0.946, RMS 0.079).
  398 frames / 52 channels / 30 fps; raw jawOpen 0.00319-0.29126.
  CPU inference approximately 3.8 seconds, excluding model initialization.
- `npm test`: 10 Node tests passed, including interpolation and validation.
- `.venv-lam-coreml/Scripts/python.exe -m unittest discover -s tests -p test_*.py`:
  2 tests passed. Python emits existing Transformers/PyTorch deprecation warnings
  during model preparation; no warning suppression or dependency changes.
- `node --check` for server and all `src/*.mjs`: passed.
- Both `node tests/browser.mjs` and `node tests/speech-browser.mjs` passed against
  `http://127.0.0.1:5179/` in isolated Edge/Playwright.
- Audio clock advances with media unmuted; pause/resume/stop/end/replay,
  collapse, caption mutual exclusion and pending-load cancellation verified.
- Captured live jaw coefficients vary; pausing publishes neutral coefficients.
  Hand-authored smile/surprise presets and mobile controls verified.
- Missing speech and hash mismatch reject playback; retry recovers.
- Full transparent/nonblank canvas, animation, drag and responsive regression
  passed at 320/768/1024/1440 and 568x320. Screenshots visually inspected.
- Automated WCAG 2.1 AA: zero violations. Normal browser path: zero errors,
  warnings and external HTTP requests. Deliberate 404s are expected failures.
- Desktop/mobile speech screenshots and JSON reports remain in ignored artifacts.
- README records reproducible preparation and distinguishes TAR inference from
  manual presets. No production/native source, model weights or dependencies
  changed. No commit or deployment. Speech demo server PID 31468, port 5179.
