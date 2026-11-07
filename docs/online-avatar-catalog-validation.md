# Online avatar catalog validation

Date: 2026-10-21. Source change only; no EXE or installer built.

## Implemented behavior

- Confirmed binding automatically queries the existing Control tenant catalog.
  The controller can select its online entries without phone distribution.
- Scope uses the binding service's actual `controllerUserId` and `tenantId`.
  A tenant ID is never substituted for a missing user identity. Own private
  records, tenant-shared records and public/default records are normalized;
  other-user/tenant private records, unsafe assets and ambiguous IDs are excluded.
- Refresh, loading, empty and sanitized error states are visible. Current avatar
  remains displayed on query failure; removed online entries cannot be selected
  from the received-role cache. Phone-delivered profiles remain compatible.
- Main resolves selected IDs to profiles; the controller cannot submit a tenant,
  user or ZIP URL. The pet cannot refresh or select via privileged IPC.
- Existing download/archive checks and actual renderer-ready voice/profile
  commit remain unchanged. Unbind/disconnect/identity change cancel and clear
  catalogs; old completions cannot restore private options. Catalogs are not
  persisted and are never sent to DeepSeek.

## Evidence

- Root `npm test`: 218 passed, including six catalog tests, channel identity,
  unchanged runtime render/cancellation tests and distribution file inclusion.
- Demo `node --test tests/device-catalog.test.mjs tests/device-channel.test.mjs`:
  focused catalog and channel checks passed. ZIP alias/model-ID compatibility
  was additionally verified by `node --test tests/device-catalog.test.mjs`.
- Demo `$env:DEVICE_CATALOG_ONLY='1'; npm run device:test`: passed using local
  account/catalog, ZIP, billing and provider fixtures. Selected own private and
  public avatars never delivered by a phone; checked actual render and voice,
  cross-user and cross-tenant rejection, binding change, unbind cleanup,
  refresh denial/empty/recovery, trusted sender, keyboard refresh, no automatic
  message/usage, clean console and axe WCAG AA. Layouts/screenshots at
  320/768/1024/1440. Report: `artifacts/device-electron/catalog-results.json`.
- Demo `npm run device:test`: full source Electron regression passed, including
  startup preconnection, first-message reuse, remote profile delivery, failed
  selection rollback, voice and original LAM inference, billing, retained UI
  settings, embedded DeepSeek continuation, account rebind and exit cleanup.
  Report: `artifacts/device-electron/results.json`.
- `git diff --check`: passed.

## Live acceptance limit

The existing public tenant 1 endpoint was queried read-only: HTTP 200 and API
code 200, with the expected record fields. No production private tenant,
account credentials or billable model sessions were used in verification.
Real private-account visibility still requires acceptance after binding to that
account. This client reuses the current API and does not alter backend access
control or manufacture user credentials. If the server denies a device-scoped
query or omits private records, the backend must provide the corresponding
binding-authorized catalog access; desktop filtering cannot grant that access.

All pre-existing workspace changes were preserved. No new dependencies,
backend/native edits, model data or credentials are part of this feature.
