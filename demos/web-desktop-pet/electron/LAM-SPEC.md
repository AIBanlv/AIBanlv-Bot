# Device LAM Inference

## Objective

Replace the device edition's RMS-driven jaw with the existing original LAM
Audio2Expression TAR and Control's unchanged mouth/pose postprocessing.
Preserve binding, paired online voice, bubbles, original controls and desktop pet.

## Contract

- Main owns persistent, hidden PyTorch and Java workers. No new HTTP endpoint,
  renderer filesystem access, model conversion, cloud inference or microphone.
- Warm the model before sending text to the provider. Missing tools fail visibly
  without a paid request or amplitude fallback. Reuse warmed workers across
  completed turns; terminate on stop/context loss/exit.
- Collect original mono PCM16LE at 24 kHz in one-second blocks, preserving
  27,200 preceding samples. Send a 51,200-sample zero-padded context window.
  Worker uses installed TorchAudio band-limited resampling to 34,133 samples,
  runs identity 0 and retains the final 30 frames at 30 fps.
- Last partial block is padded only for inference; play exactly the original
  PCM and retain ceil(samples / 800) model frames.
- Java maintains one AudioClockExpressionTimeline per worker, with PCM fallback
  disabled. Feed model-order frames once, retain filtering state across blocks,
  return canonical 52-channel frames and six pose channels. Finish supplies
  the existing one-second closing animation.
- Feed raw assistant snapshots to Control's existing ExpressionBehavior parser
  before postprocessing; bracket filtering affects display only. Explicit emotion,
  performance, head/gaze/depth directives and semantic inference retain the native
  precedence. User head/depth requests use the existing native userMotion parser.
  Coalesce snapshots, reject old turns, and clear private text on cancellation.
- Preserve the timeline and random-motion source across completed turns instead
  of reseeding the same first frame. Silence releases rig ownership instead of
  commanding bind-neutral. Device-only rig ownership handoffs interpolate from
  the last visible rotation/position for 350 ms; steady speech remains unmodified.
- Emit audio only with validated expression. Renderer schedules both using
  AudioContext.currentTime, interpolates frames, and never advances queued or
  suspended audio's mouth. Volume does not change expression. Underruns must
  not replay a previous phoneme.
- Main owns response identity and a bounded ordered queue. Stop, context loss
  or failed workers discard late results. Preserve billing/cancellation drain.
- JSON-lines workers use one in-flight request with numeric correlation ID.
  Bound bytes, startup/job times, PCM duration and frame dimensions. No user
  audio, text or credentials in logs/files. Generated classes stay in artifacts.

## Structure And Style

`scripts/device_lam_worker.py` loads the trusted existing TAR.
`scripts/ControlLamStream.java` adapts the production timeline.
`electron/device-lam-worker.mjs` owns bounded subprocess RPC.
`electron/device-lam.mjs` owns buffering and event sequencing.
`electron/device-audio.mjs` owns audio-clock presentation.
Use existing ES modules, named camelCase fields and single quotes:

```javascript
{ type: 'audio', requestId, pcm, sampleRate: 24000, expression: {
  pipeline: 'ios-expression-v1-2e75b5f', fps: 30, frames, poses,
} }
```

## Verification

From `control/demos/web-desktop-pet`:

- `npm test`
- `F:/zhanlvAndroidSdk/.venv-lam-coreml/Scripts/python.exe -m unittest discover -s tests -p test_device_lam_worker.py`
- `node tests/device-lam-python.mjs`
- `node tests/device-lam-inference.mjs`
- `node tests/device-lam-control.mjs`
- `npm run device:test`
- `npm run device`

Prove actual original-model inference and varying mouth channels on known
speech, exact sample counts, persistent filter state, audio-clock alignment,
volume independence, cancellation and no stale results. Use real Electron with
local service fixtures and actual LAM/Control workers; inspect canvas pixels,
diagnostics and screenshots. Measure startup/inference. No paid cloud tests.

Always preserve unrelated changes and offline editions. Ask before adding model
dependencies or changing backends/native algorithms. Never replace LAM with
procedural mouth motion or suppress a failing test to claim inference works.
