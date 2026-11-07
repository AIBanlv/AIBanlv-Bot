# Self-contained text and action desktop edition

## Objective and approved scope
The user requested a separate Windows Electron edition without lip inference,
with all required runtime resources packaged. Text and tags start captions and
procedural face/head animation immediately after the avatar is ready. Existing
speech edition remains available. No Python, Java, TAR, ONNX, external service,
audio synthesis or model inference at runtime. Plain-text intent uses a small
documented rule set, not an LLM. One head/emotion/gaze/depth tag per message.

## Structure and style
`src/text-motion.mjs`: bounded parser and pure animation sampling.
`electron/text-controller.*`: accessible controller using existing visual styles.
`electron/text-server.mjs`: authenticated allowlisted static assets, no API.
`electron/main.mjs`: shared native lifecycle with explicit text edition mode.
`electron/text-package.mjs`: bundle only text-edition resources and Electron.
Use ES modules, descriptive camelCase, single quotes, no new dependencies.

## Commands and verification
`node --test tests/text-motion.test.mjs`: parser, neutral mouth, smooth motion,
caption pagination and invalid input. `npm test`: existing behavior regression.
`node electron/text-package.mjs`: Windows x64 portable application directory.
`node tests/text-electron.mjs`: actual packaged EXE in relocated directory with
invalid external runtime paths; check transparent moving pixels, head/face,
caption safety, stop/pause/hide/replay, native controls, no inference/media/network
or Python/Java children, accessibility and response latency. Inspect screenshots.

## Boundaries and acceptance
Always validate tags, preserve old edition and native IPC sandbox boundaries.
Never change production renderers, download models or require machine paths.
No installer/autostart/automatic updates. Distribute the complete application
folder, not the EXE alone. The renderer remains GPU accelerated and resident.

## Ordered tasks
- [x] Pure text parser and animation sampling, failing then passing Node tests.
- [x] Text controller, native mode and static-only resource boundary.
- [x] Self-contained build, relocated packaged runtime checks and delivery.

## Verification record (2026-10-17)
- `npm test`: 25 passed. New pure action tests first failed with missing module,
  then passed with bounded tags, Unicode captions, moving pose and zero speech jaw.
- `node electron/text-package.mjs`: Windows x64 build with Electron 44.9.0;
  ASAR contains the allowlisted assets and shared native shell, no external config.
- `node tests/text-electron.mjs`: passed on a copied directory with spaces and
  Chinese characters and deliberately invalid Python, Java, model and avatar env
  paths. Actual main process descendants were five ControlTextPet.exe processes;
  no external requests, inference/media requests or page exceptions.
- True alpha/nonblank animated canvas, head yaw and pitch, smile screenshot,
  pause/resume/end/stop/edit/replay/hide, invalid-tag recovery, escaped HTML,
  captions toggle, resize/pin/click-through and keyboard movement passed.
- WCAG 2.1 AA automated checks passed; controller widths 360/480/768/1024/1440
  had no horizontal overflow. Screenshots inspected at desktop and small pet size.
- Caption DOM transport samples: 21/0/1/2/1 ms from click handler to caption
  mutation, using coarse wall clock; not GPU presentation timing or motion onset.
- `npm run desktop:test`: existing speech edition passed using the modified
  shared main process, including original-TAR generation and native lifecycle.
- Test fixes retained actual checks: sample multiple frames rather than a nod's
  zero crossing; use Electron main PID instead of Playwright's cmd launcher PID.
- Syntax checks passed for shared main and text controller. Original avatar,
  renderer, production Android sources and model weights were not modified.
- Runtime reports/screenshots are ignored under `artifacts/text-electron`;
  verified relocated application is recorded in `dist/text-portable.json`.

## Limitations
Procedural head/face animation reuses the existing renderer pose interface; it
does not claim byte-for-byte parity with the original Java postprocessor. Local
plain-text rules recognize a few explicit head instructions and positive words;
use tags for predictable actions. Initial avatar loading still takes time;
continuous rendering still uses graphics memory/GPU. No installer or signing.
