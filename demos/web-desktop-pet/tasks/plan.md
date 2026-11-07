# Web Desktop Pet Plan

## Account Login (2026-10-22)

Continue the approved `../../../docs/account-login-spec.md`, preserving the
existing uncommitted Realtime billing changes.

1. Verify the existing password/identity parser and temporary controller binding
   with `node --test tests/device-login.test.mjs tests/device-channel.test.mjs`.
2. Wire controller-only IPC, cancellation, private state and package allowlists.
   Verify module inclusion with `node --test tests/device-modules.test.mjs`.
3. Add QR/password mode controls, keyboard submit and bounded status/error UI.
   Verify using `node tests/device-electron.mjs` with local network fixtures.
4. Review cancellation races and protocol compatibility; run root `npm test`,
   runtime dependency audit and `git diff --check`; record exact evidence.

The existing backend does not correlate successful binding with request IDs.
Cancel stops local waiting, not a server-side binding already committed.
Never issue compensating unbinds or ignore authoritative restored/QR bindings.
No backend change, real-account automated login, EXE build or installer build.

## Device Test Distribution (2026-10-19)

1. Move captions/bubbles below avatar; update native hit regions and regressions.
2. Stage relocatable Python/LAM, compile Control and bundle Java; validate runtime
   selection without modifying the developer installation or model weights.
3. Build a dedicated device package using allowlisted files and existing Packager.
4. Build a per-user installer with shortcuts, uninstall and dependency notices.
5. Install in an isolated path, run actual packaged Electron/LAM tests, inspect
   screenshots, verify uninstall and publish the installer with SHA-256.

Contract: `electron/DISTRIBUTION-SPEC.md`. Python/model staging can proceed while
layout is updated. Installer creation follows a working independent package.
Main risks: hidden developer-path dependencies, runtime redistribution, private
data inclusion and click-through geometry after moving the chat area.

## Device LAM (2026-10-19)

1. Prove persistent original-TAR inference on bounded PCM windows with Python tests.
2. Adapt unchanged Control timeline through bounded Java/Node worker protocol;
   verify channel order and cross-block state.
3. Buffer provider PCM, pair inference with original audio, cancel by turn
   and integrate with existing Realtime lifecycle.
4. Sample full face/pose by actual Web Audio playback time; remove RMS jaw.
5. Run unit, actual-model and Electron regressions, review and restart device.

Contract: `electron/LAM-SPEC.md`. Main risk is stale mouth shapes from delayed
inference: never play an uninferred block. One-second blocks add buffering;
measure startup and steady-state performance.

## Realtime Voice Mapping Fix (2026-10-19)

1. Reproduce the missing CosyVoice-to-Realtime mapping in session tests.
2. Read scoped stored voice metadata and reuse Control's canonical pairing;
   retain original profiles and validate the resolved provider voice exactly.
3. Verify service failures, cancellation, tenant/alias ambiguity and real
   Electron bubbles/audio. Restart only the device app with its identity intact.

## Realtime Bubbles (2026-10-19)

Continue the approved device edition, using Control's existing native Realtime
contract. No new backend, provider or dependency is required.

1. Test/implement bound-device session bootstrap and credential/voice validation.
2. Test/implement billing registration and response-scoped Realtime events.
3. Connect narrow main/preload IPC, cancellation and actual PCM playback.
4. Replace unavailable composer state with streaming bubbles, stop and volume;
   retain original controller and under-avatar input.
5. Verify Node regressions and isolated Electron service fixtures, real audio
   clock/pixels, responsive screenshots, lifecycle and independent review.

Each slice has its focused tests before moving on. Primary risks: stale
credentials/audio after role changes, billing loss, duplicate submissions,
provider errors, PCM backlog and overflow in the small transparent window.
No production credits or real user session will be used for automated tests.

## Device Desktop Pet Revision (2026-10-19)

1. Test pet geometry and composer/identity boundary before changing windows.
2. Restore the separate controller and transparent pet, reusing existing
   text/action controls, sizing/drag policy and tray interaction conventions.
3. Add the under-avatar composer and explicit unavailable-service result;
   do not invent a chat backend or send controller-only messages as a device.
4. Verify both native windows, mouse/keyboard input, IME, actions, binding,
   avatar/voice switching, desktop sizing, screenshots and cleanup.

## Device Edition (2026-10-19)

The new request extends this demo; earlier completed work remains intact.
Contract: `../electron/DEVICE-SPEC.md`.

1. Add a separately launched native device with server-issued QR, installation ID,
   bounded reconnect/heartbeat and tests proving binding gates.
2. Apply App profiles through validated HTTPS ZIP downloads and the existing
   renderer; keep voice ID and image atomic and acknowledge only actual readiness.
3. Use online TTS with the applied voice ID once its device authentication
   contract is confirmed. Never substitute system speech.
4. Verify the protocol and real Electron UI; retain the original launch commands.

Binding/avatar slices are implemented and verified. The Realtime revision above
replaces the initial speech placeholder. Verification evidence is in `todo.md`.

Risks: server identity is the existing protocol, not a new authentication model;
archive content must be bounded; late loads cannot overwrite a newer profile;
voiceId alone is not a cloud credential. Verification checkpoints follow each
slice. Do not edit sibling backend/Android projects.

Scope approved by the user: an isolated Control demo with an actual avatar,
transparent dragging and demonstration captions; prefer original model assets.

## Decisions

- Keep all demo-owned files here. Do not modify production or generated files.
- Reuse the installed Three.js-based Gaussian renderer and uni-icons font.
- Read the original avatar ZIP from an explicit local path without copying it.
- Use a same-origin iframe to isolate the renderer's shared canvas and lifecycle.
- Host owns dragging and captions. Validate message origin, source and type.
- Do not start microphone, inference, billing or external network requests.
- TAR/PyTorch inference remains a documented future boundary, not a fake browser feature.

## Order

1. Test the explicit file-serving boundary, then render real ZIP assets.
2. Test geometry and caption timing, then build the host interactions.
3. Verify real browser rendering, alpha, animation, input and responsive layout.
4. Document exact startup, tests, model selection and known limitations.

## Risks

- Renderer has a shared canvas and asynchronous loading: iframe reload owns retry.
- The third-party loader can swallow errors: explicit timeout and failed state.
- Full-rectangle iframe intercepts input: host uses a compact drag surface.
- Archive and installed renderer are local prerequisites: validate before listen.
- No runtime speech in v1: captions are explicitly marked as demonstrations.

Tasks and completion evidence are in `todo.md`.

## Speech Increment

User requested audible speech and facial expressions. Generate a reproducible
offline English sample with translated captions, then run the original TAR on
CPU. Verify timeline validation/interpolation first, wire audio-clock-driven
weights to the existing iframe next, then check playback and rendered pixels.
Keep weights and generated assets out of Git. No online TTS or ONNX conversion.

## Control Postprocessing

1. Add a tested offline adapter that invokes the unmodified production Java
   timeline and captured library; export named face/pose tracks with hashes.
2. Validate and sample those tracks, add a default-on A/B toggle, and reuse
   the production Three.js presentation adapter without duplicate rig gain/blink.
3. Verify numeric parity, failed assets, playback transitions, actual bone pose,
   responsive screenshots and existing tests. Document precomputed boundaries.

## Tagged Silent Preview

1. Prove local Mandarin PCM retrieval without playback; reuse original inference.
2. Compile the canonical behavior parser; strip validated directives in the demo
   adapter and feed behavior into the unchanged production timeline.
3. Add bounded same-origin POST generation with cancellation and private temp files.
4. Add editor and silent performance-clock playback with mutual exclusion.
5. Verify real inference, tags, API boundaries, browser lifecycle, pixels and layout.
