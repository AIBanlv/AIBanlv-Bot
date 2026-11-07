# Online avatar catalog

## Objective and acceptance

The bound desktop queries Control's existing online avatar list and can select
an avatar never distributed by a phone. Keep phone profile delivery compatible.
Use only the binding server's tenant and controller user, never renderer scope.
Include tenant shared records and the bound user's private records (`userId`),
plus public/default records; reject private records owned by another user or
tenant. No private production data is used in automated tests.

## Source contract and boundaries

Reuse `control/api/home.js`'s GET
`https://scrm.ieasysell.com/jwt/client/aliBot/getBotListTWithPublic?tenantId=...`.
Public tenant 1 was checked read-only on 2026-10-21: HTTP/code 200, `data` array;
records include `tenantId`, `userId`, `isDefault`, `digitalHumanId`, `voiceId`.
Do not invent an auth token, impersonate a controller, enumerate other tenants,
or treat a failed/unauthorized response as a successful empty private catalog.
Backend authorization remains the API's responsibility; client filtering is
defense in depth and does not establish backend authorization correctness.

Use confirmed binding identity, HTTPS, no redirects/cookies, 15-second timeout,
bounded JSON/list sizes, normalized allowed profile fields and existing asset
URL/archive validation. Preserve role settings, voice, language and Control ZIP
layout (`tenant/model/model.zip`, default assets use tenant 1).
Keep catalogs in memory only. Unbind, disconnect, owner/tenant change and quit
cancel queries and clear options; late responses cannot restore old records.
Refresh replaces selectable online entries; a displayed current role remains
visible but no longer selectable if removed from the catalog.

## Stack, structure and style

Existing Electron 44.9.0, ES modules and Node test runner; no new dependencies.
`electron/device-catalog.mjs` owns network/identity lifecycle; main owns selection
and passes safe labels to the controller. Existing runtime owns download/render
and applied reports. Renderer sends only a selected ID.

```js
const profile = catalog.find(agentId)
if (profile) runtime.apply({ ...profile, profileVersion: 0 })
```

Follow single quotes, camelCase, small named functions and textContent/Option
for untrusted names. UI adds a refresh button and loading/error/empty states,
keeps keyboard selection, existing layout and WCAG AA.

## Commands and testing

Demo: `node --test tests/device-catalog.test.mjs`, `npm run device:test`.
Repository root: `npm test`; final `git diff --check`.
Test no requests before full binding, own-private/shared/public inclusion,
cross-user/tenant exclusion, stale cancellation, refresh failure, safe ZIP
normalization, and actual Electron selection/render/voice without a phone push.
Verify keyboard, 320/768/1024/1440 layouts, axe and clean console with local fixtures.
Never build an EXE or installer without an explicit user build request.
