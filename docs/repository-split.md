# Repository Split

## Objective

Store and develop the Windows desktop demo in
`https://github.com/AIBanlv/AIBanlv-Bot.git`, independently of the
Control application repository. Preserve the original workspace checkout.
No product behavior, online protocol, billing policy, or model is changed.

## Source

- Imported on 2026-10-19 from `control/demos/web-desktop-pet`, version 0.1.2.
- The demo was untracked in Control; this import is its initial Git snapshot,
  not a claim that it existed in Control commit history.
- Shared source snapshot: `efficiency-control` commit
  `8b2844c8628d759e4fa3a6d80d7df181d56b8089`.
- Only the three renderer adapter modules, Java expression sources, two
  playback classes, action JSON, voice-pair helper, and logo are copied.
- Shared files retain their paths and implementations. They are not linked
  to the old checkout. Subsequent upstream updates require explicit review.
- The `android-native` directory is a desktop source subset, not an Android
  Gradle project. Do not run Gradle here.

## Structure And Commands

- `demos/web-desktop-pet`: existing Electron/web entries, scripts and tests.
- `android-native`: the shared rendering and expression source subset.
- `utils/voicePairs.js`, `static/logo.png`: device runtime dependencies.
- Root `package.json`: installation and command shortcuts only.
- Install: `npm ci`, then `npm run setup`.
- Test: `npm test`.
- Start device: `npm start`.
- Package: `npm run package:device`, then `npm run installer:device`.
- Java checks, from the demo: `node scripts/prepare-control.mjs --test`.
- Runtime checks, from the demo: `node tests/device-electron.mjs`.

## Implementation And Style

Preserve existing ESM, two-space indentation and no-semicolon conventions.
Derive packaged entry paths from the actual checkout, not a hard-coded
directory name. Keep imports and resource URLs otherwise unchanged.

```js
const main = bundleEntry(root, 'device-main.mjs')
```

## Plan And Acceptance

1. Import the source and minimal shared dependencies without modifying Control.
2. Pin installable frontend dependencies and document external build resources.
3. Fix the three packaged entry paths and add regression coverage.
4. Run the complete Node suite, Java checks, a text package and Electron checks.
5. Review staged paths, secrets and sizes; push without rewriting remote history.

Success means all device bundle source paths resolve within this checkout,
existing tests remain enabled, a renamed repository produces a runnable
package, and the remote branch contains the reviewed commit.

## Boundaries

- Always preserve original source, tests and remote initialization history.
- Ask before deleting the original demo or changing protocols/dependencies.
- Never commit credentials, profiles, model weights, archives or installers.
- Python/LAM, Gson/JDK and optional avatar ZIP remain external resources.
- No production session or billable conversation is needed for verification.

## Verification Record (2026-10-19)

- `npm test` from the repository root: 127 passed, none skipped.
- `node scripts/prepare-control.mjs --test` from the demo: numeric parity
  (90 x 52), pose parity and directive parsing passed.
- `node tests/device-lam-control.mjs`: 11 Control LAM scenarios and 30 Java
  RPC requests passed.
- `npm run package:text` from the repository root: Windows x64 package built.
- `node tests/text-electron.mjs`: relocated package with a Chinese/spaced
  path, transparent animated renderer, text actions, window controls and
  WCAG AA checks passed without external model runtimes.
- `node tests/device-electron.mjs`: local protocol fixtures, decoded QR,
  binding/role changes, original LAM inference, streaming audio/text,
  billing acknowledgements, window interaction and WCAG AA checks passed.
- `npm audit --json` from the demo: zero reported vulnerabilities.
- Reviewed source differences, credential patterns and upload paths. Models,
  avatar archives, dependencies, fixtures and build/test output are excluded.

The split exposed an undeclared `ws` dependency used by the localhost tests;
it is now pinned as a development dependency with its lockfile. Electron was
installed using `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
and the existing checksum-verified cache after the default download failed.
Runtime verification used existing local QA tools, model and avatar resources;
these are not uploaded. No live cloud conversation or phone binding was tested.
