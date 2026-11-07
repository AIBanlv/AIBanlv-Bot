# First-send local warmup

Date: 2026-10-21. Source-only verification; no EXE/installer build.

## Cause and change

Realtime was preconnected, but `DeviceLam.begin()` still loaded Python/Torch,
the original model, its initial validated inference and Control/Java on the
first actual message. A direct local baseline measured startup 4788 ms,
Control reset 15 ms, inference 136 ms and subsequent inference 130 ms.

The bound, visible companion now prepares this engine independently
of avatar loading and the realtime handshake. A fresh model with no user turn
state survives initial role selection instead of restarting its factory.
Warmup creates no conversation turn or model reply,
does not record audio, and shares one pending startup with early input. The
first real turn still resets Control and checks readiness. Hide/context loss
cancels startup and drains process cleanup; a visible stop/error can prepare a
fresh engine. Failed background warmup remains retryable by explicit input.

The routine catalog-success sentence and technical voice-ID line are removed.
An empty catalog, loading and actionable query errors remain visible. Voice
configuration and validation are retained internally.

## Local performance experiment

Demo command: `node tests/device-first-send-benchmark.mjs`.
Three independent cold/prewarmed pairs use the same original model, one-second
speech PCM and validated Control processing. No cloud/model provider calls.

| Stage from simulated first send | Cold median | Prewarmed median |
| --- | ---: | ---: |
| Required local preparation | 4418 ms | 16.5 ms |
| First validated local audio block | 4609 ms | 195 ms |

Cold preparation samples: 6366/4418/3590 ms; warm: 21.7/16.5/16.0 ms. The model
loading cost is moved into startup, not eliminated. OS caches and compilation
vary across samples; the send-path reduction exceeds that variation. The
benchmark asserts both warm medians below one quarter of cold medians. Machine
report: `demos/web-desktop-pet/artifacts/first-send-benchmark.json`.

## Runtime verification

Demo `$env:DEVICE_LATENCY_ONLY='1'; npm run device:test`: passed. Source Electron
with local control/billing/provider fixtures and actual original LAM inference
automatically warmed before input. The first message reached the fixture in
348 ms and began audio scheduling in 697 ms; background readiness wait was
6 ms after role rendering. Starting local warmup only after rendering had
previously left a 7046 ms wait in the same scenario, so the final integration
starts it at binding and overlaps avatar loading. A synthetic 1500 ms first-send budget guards
against reloading the model on that path. Hide releases the engine, show warms
again and unbind cancels it. No automatic message, usage or microphone capture.
Both requested hints are absent. Report:
`demos/web-desktop-pet/artifacts/device-electron/first-send-results.json`.

Node lifecycle tests cover shared warmup, late factory cancellation, background
failure recovery, replacement/shutdown races and visible-stop rewarming, plus
fresh-model reuse across initial role selection and the existing PCM,
directives, history, inference and audio-order contracts.

- Root `npm test`: 224 tests passed.
- Demo `node --test tests/device-lam.test.mjs tests/device-lam-engine.test.mjs`:
  18 tests passed.
- Demo `npm run device:test`: full source Electron regression passed, including
  original LAM/Control mouth and owned poses, voice/billing, first-message
  connection reuse, role changes, assistant continuation and exit cleanup.
  The pose snapshot now waits for actual owned-frame delivery, retaining its
  positive pose and 52-channel articulation assertions rather than sampling
  an asynchronous renderer after a fixed delay.
- Demo `$env:DEVICE_CATALOG_ONLY='1'; npm run device:test`: passed after hint
  removal. Verified hidden success feedback, absent voice-ID line, retained
  query error/empty/recovery states, role/voice application, identity isolation,
  responsive layouts and WCAG AA checks.
- `git diff --check`: passed. No dependency changes or package/installer build.

These timings describe local preparation and synthetic services. They do not
measure the production provider's first-token/audio latency or guarantee a
fixed end-to-end reply time. Input arriving before warmup finishes waits for
the remaining initialization. No production paid session was used.
