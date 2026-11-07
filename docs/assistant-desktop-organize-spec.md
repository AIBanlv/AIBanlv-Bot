# Reversible Desktop Organization

## Objective

Use the current user's desktop from Electron `app.getPath('desktop')`, including
redirected desktops. Do not scan other users, Public Desktop or arbitrary paths.

- `control_plan_desktop({ target: "desktop" })`: confirm disclosure of desktop
  names, inspect only top-level files, return an opaque plan id and exact moves.
- `control_organize_desktop({ target: planId })`: confirm the complete move list,
  revalidate the snapshot, persist recovery metadata, then execute the plan.
- `control_undo_desktop({ target: batchId | "latest" })`: preview and confirm
  returning unchanged organized files to their exact original paths.

Only recognized document, image, audio, video and archive extensions are moved
into category subdirectories of a newly created `AIBanlv-Desktop-<id>` folder.
Leave shortcuts, executable/script files, hidden/system names, unsupported files,
all existing folders and reparse points untouched. Bound each preview to 100
eligible files and fail visibly above the cap rather than silently moving a subset.
File contents are never sent to a provider by these tools.

No overwriting, deletion, recursive reorganization or file-content modification.
Use Windows' non-replacing file move. Persist the approved plan before moving;
after failure/cancellation inspect actual paths rather than automatically retrying.
Recovery records live outside the disposable Harness home and survive restart.
Restore refuses changed files or occupied original paths. Empty created directories
may be removed non-recursively; preserve folders containing new user data.

## Implementation

Owner: `demos/web-desktop-pet/electron/`; focused filesystem tests in `tests/`.
Use existing ESM and dependency injection at the OS/approval boundaries.
Validate model arguments, persisted records and filesystem state. Keep app catalog,
filesystem tools and broker orchestration separate. No new dependencies.

```js
const result = await organizer.apply(planId, { signal })
// Results explicitly distinguish complete, partial and unchanged outcomes.
return result
```

Always keep the initial recovery record even if outcome acknowledgement is lost.
Never delete source data to emulate an unsafe move. Never treat filenames or
document contents as instructions or as authorization. Approvals default to denial.

## Verification

From `demos/web-desktop-pet`:
`node --test tests/device-assistant-desktop.test.mjs`
`node tests/device-assistant-service-embedded.mjs`
`$env:DEVICE_ASSISTANT_ONLY='1'; npm run device:test`
From root: `npm test`.

Fixtures use temporary desktops, never the user's real desktop. Cover unchanged
preview, categorization, exclusions, collisions, tampered records, symlinks,
changed files, denial, cancellation, partial moves, restart recovery and undo.
Exercise native non-overwrite movement in an isolated temporary directory.
No EXE/installer build, actual desktop organization or paid API requests.
