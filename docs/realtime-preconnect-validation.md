# Startup realtime preconnection validation

Date: 2026-10-21. Scope: `demos/web-desktop-pet`, source only.

The companion now preconnects after binding and successful avatar rendering.
Background startup and early user input share one cancellable connection.
A ready first send displays sending/thinking without a connecting flash.
The connection stays open across ordinary idle periods, renews before grant
expiry and retries failures up to five times with exponential backoff
(1/2/4/8/16 seconds). No messages or computer tasks are replayed.

Role/voice/tenant/render-context changes invalidate old work. Hide, unbind and
quit cancel the provider and pending startup. Configuration errors stop
background retries; an explicit send can try again. Stopping a reply can
prepare another connection while the companion remains visible and bound.

Verification:

- Repository root `npm test`: 211 tests passed.
- Realtime coverage in `device-realtime.test.mjs`: 30 tests passed. Covers
  no automatic generation/usage, early-message sharing, late grants, idle reuse,
  bounded retry, disconnect recovery, expiry renewal, cancellation, preserved
  session errors, usage draining, visible turn cancellation on context loss
  and assistant tool isolation.
- Demo `node --test tests/device-chat.test.mjs`: 10 tests passed. Covers
  interactive background state, warm first-send status, draft and error retention,
  voice/touch and safe reply rendering.
- Demo `npm run device:test`: full source Electron fixture passed. Startup
  provider configuration precedes all messages and usage. The first successful
  send leaves the bootstrap count unchanged and a DOM observer sees no
  connecting status. Original LAM inference, voice, billing, role switching,
  responsive/accessibility checks and embedded DeepSeek continuation pass.
  Report: `demos/web-desktop-pet/artifacts/device-electron/results.json`.
- Demo `$env:DEVICE_GAZE_ONLY='1'; npm run device:test`: passed. Hiding
  closes the connection and no background bootstrap occurs during the hidden
  interval; gaze/cancelled touch sends no text and generates no usage.
- Demo `$env:DEVICE_INITIAL_ONLY='1'; npm run device:test`: passed. Unbind
  cancels the connection with no later bootstrap; rebind preconnects again.

Reviewed the lifecycle, renderer status and cancellation paths for correctness,
credential isolation and bounded work. No new dependencies or IPC privileges.
`git diff --check` passed. EXE/installer builds were intentionally omitted.

All cloud/model traffic used local fixtures. Production latency and provider
billing were not measured. Preconnection configures a session; it does not
send text/audio or request a generated response, nor enable the microphone.
No EXE package or installer was built for this change, as requested.
