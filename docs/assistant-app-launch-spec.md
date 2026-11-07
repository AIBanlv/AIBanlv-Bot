# Application Launch

## Objective

`control_open_app({ target })` resolves an application name from Windows'
current-user Start application catalog at runtime. An opaque selection token
can select one previously returned candidate. No installation directory is
hardcoded or persisted. No model-supplied executable path, arguments or script
is accepted.

Duplicate matches return candidates instead of guessing. Executable-backed
entries and registered Application User Model IDs are supported. Uninstallers,
installers and shell command hosts are excluded. Portable programs not registered
with Windows are out of scope. Exact target approval precedes dispatch; discovery
is repeated after approval and a changed target is refused. Report OS launch
submission, not an unverified claim that a window is ready.

## Implementation

Owner: `demos/web-desktop-pet/electron/`. Keep Electron calls in the main process;
use a bounded, fixed Windows discovery helper, never interpolated commands.
Use existing ESM style and native confirmation:

```js
const result = await launcher.run(target, { signal })
signal.throwIfAborted()
return result
```

Dependencies remain pinned and unchanged. Preserve web/folder/text operations,
key privacy, controller-only entry, cancellation and broker session binding.

## Verification

From `demos/web-desktop-pet`:
`node --test tests/device-assistant-apps.test.mjs`
and `node tests/device-assistant-service-embedded.mjs`.
From the repository root: `npm test`.
Source Electron: `$env:DEVICE_ASSISTANT_ONLY='1'; npm run device:test`.
No EXE/installer build or billable provider session is authorized by this task.

Tests cover per-user paths, exact/ambiguous/missing names, forged selection ids,
path/argument injection, denial, cancellation and changed catalog entries.
Native discovery may be checked read-only; production application launches
require the normal user confirmation.
