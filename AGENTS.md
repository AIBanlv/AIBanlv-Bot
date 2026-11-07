# AGENTS.md

## Scope

This is the canonical Control desktop repository for Windows x64 and macOS x64/arm64.
All platforms share the same UI and conversation source in this repository.
Read `CROSS-PLATFORM-SPEC.md` for Mac inference and distribution requirements. The main project
is `demos/web-desktop-pet`; `android-native` contains only the shared source
subset used by that desktop project, not a buildable Android application.

## Workflow

- Read root README and the relevant demo spec before editing.
- Preserve existing user changes and unrelated entry points.
- Use `rg` for searches and `apply_patch` for manual edits.
- Run `npm test` at the root for the complete Node test suite.
- Build EXE packages or installers only when the user explicitly asks to build.
  Ordinary implementation and verification requests authorize source tests only.
- For Java changes, run `node scripts/prepare-control.mjs --test` and
  `node tests/device-lam-control.mjs` from `demos/web-desktop-pet`.
- For UI/runtime changes, use the existing Electron tests with local network
  fixtures. Do not create billable production sessions for automated tests.
- Keep dependencies pinned in their owning manifests and lockfiles.
- Never commit model weights, installation packages, local configuration,
  device identity, private avatars or credentials.
- Do not modify the old sibling `control` checkout as part of desktop work.
- Shared source updates are explicit snapshots, not automatic synchronization.

## Commits

Write commit summaries in Simplified Chinese using
`<type>: <Chinese summary>` or `<type>(<scope>): <Chinese summary>`.
Review staged changes and verification results before committing.
