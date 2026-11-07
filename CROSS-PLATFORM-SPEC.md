# Shared desktop revision — 2026-10-20

The user requested one repository for Windows and Mac, retaining x86_64 and
adding native Apple Silicon plus validated accelerator selection. This revision
supersedes older Windows-only runtime and model-lifecycle requirements.

- `control-windows/` is the canonical standalone Git repository. HTML, CSS, renderer,
  preload, binding, voice pairing, billing and conversation code are shared.
  Make subsequent changes here. The old `control-windows-master` and
  `aibanlvcontrol/desktop` directories are migration sources, not ongoing
  development entry points. Preserve the newer Windows features in this repository.
- Build Windows x64 on Windows; build Mac x64 or arm64 on macOS. The Electron
  binary, Swift worker and Java runtime must all match the requested architecture.
  Never claim arm64 runtime validation from an Intel cross-build.
- Windows retains its existing PyTorch/original TAR path and NSIS installer.
  Mac reuses the phone's original Core ML package; no precision change or new
  model conversion is part of this revision.
- Mac probes run in disposable processes with hard deadlines. Compare finite,
  bounded, input-dependent output against CPU across three fixed waveforms;
  select a measurably faster healthy backend. Cache only hardware/model/worker
  identity, backend and numeric timings under userData, never audio or text.
- Runtime accelerator errors/frozen outputs replay only the same local audio
  block on CPU. Do not retry any cloud/billing request. CPU failure stays visible.
- Warm on avatar readiness. On Mac, model lifetime is independent of a reply;
  stop/context change invalidates pending frames and resets private Java state
  before reuse. Hiding or losing active authorization releases the model on all
  platforms. Exit or failed workers terminate owned processes. Windows keeps
  its current prewarm and reply lifecycle.
- Keep PCM, frame counts, canonical channel order and audio-clock sync unchanged.
  Resampling and memory optimizations must preserve this contract.
- Unit CI uses synthetic archive fixtures on both OSes. Full Electron validation
  uses local service fixtures and actual local models/avatars, with no paid session.
- Generated models/runtimes/packages/profiles stay out of Git. Dependencies and
  redistributable downloads remain version-pinned with checksums.
