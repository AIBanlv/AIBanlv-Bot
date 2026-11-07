# Startup Realtime Connection

## Objective

After startup, automatically connect once a bound, connected device has a
rendered role and the companion is visible. The first text/voice/touch turn
reuses that connection. Show connection progress before a message, and show
sending/thinking rather than an unconditional connecting state for a warm turn.

## Contract

- First-send revision (2026-10-21): prepare the original local LAM/Python and
  Control/Java engine once binding is confirmed and the companion is visible,
  in parallel with avatar lookup/download/rendering. Python readiness already includes a validated offline zero-window
  inference. A user arriving during warmup shares that startup; no second
  worker or private turn is created. Retain the engine for normal idle reuse.
  A fresh model with no user turn state can survive initial avatar selection;
  private turn state is always discarded on stop or role replacement.
  Hide, disconnect, unbind and quit cancel warmup and drain its process cleanup.
  A visible stop/error can warm a fresh engine for the
  next input. Warmup failure must remain retryable and never invent a reply.
  The real turn still resets Control state and waits for validated readiness.
- Remove the routine catalog-success sentence and technical voice-ID line
  from the controller; retain actionable catalog loading/empty/error feedback.

- Preconnect performs authenticated bootstrap, billing-producer registration,
  provider handshake and `session.update` only. It sends no conversation item,
  audio buffer or `response.create`; no generated response or usage is reported.
  The optional one-time first-install welcome is a separate, tool-disabled turn
  dispatched only after full readiness; see `first-greeting-spec.md`. Ordinary
  startup, reconnect and upgrade still never generate an automatic reply.
- One in-flight connection shared by background startup and an early message.
  LAM readiness remains required before real messages are submitted, normally
  fulfilled by background startup rather than first-send model loading.
- Unbound/loading/disconnected/hidden devices do not preconnect. Role, voice,
  tenant and render-context changes invalidate old work; late handshakes cannot
  replace a new connection or submit a message.
- While active, keep a ready connection across idle periods; refresh expired
  sessions and retry transport failures with bounded backoff. Never replay
  messages or computer tasks. Invalid voice/session configurations stop background
  retries until the context changes or the user explicitly sends again.
- Stop cancels the current turn; background reconnection may prepare the next
  turn while the companion remains active. Hide, unbind and quit stop it fully.
- Existing voice pairing, billing authorization and usage/cancellation accounting
  remain in force. Provider charges are not inferred from local fixtures.
- Voice selection follows the fixed Realtime engine. A configured CosyVoice
  record resolves to its unique Realtime variant within the same owner before
  session creation. Shared `localUrl` training recordings identify renamed
  variants; legacy records without recording metadata use normalized names.
  Different recordings, cross-owner pairs and ambiguous variants cannot pair.
  Missing variants stop session creation instead of changing the engine.
- Metadata reuses the deployed read-only `POST /client/Voice/aliyun/listClientVoices`
  endpoint (`/legacy/client` behind nginx), reading `data.localVoices` in pages
  of 100 for the bound and public owners. It includes stored voice types 4/5;
  the old `searchAliyunVoiceByTenantId` endpoint only returned type 5. The JWT
  list forces the authenticated owner and cannot enumerate the public scopes.
  Any failed or malformed page aborts pairing before session creation.
  Verification: 498 Node tests pass, including cross-page type 4 Island pairs.
  A read-only production catalog check returned 51 public voices and resolved
  `2110177870547836929` to Realtime row `2110177874905718786`; session creation
  used a local simulated response, without issuing a production billing session.
- No packaging or installer build without an explicit user build request.

## Implementation and Verification

ES modules and Node tests in `demos/web-desktop-pet`. Reuse DeviceRealtime,
DeviceWindows lifecycle and DeviceChat; do not alter sibling projects.

1. Shared connection lifecycle and preconnect tests in `device-realtime.test.mjs`.
2. Startup/context/visibility wiring in `device-main.mjs` and `device-windows.mjs`.
3. Connection status in DeviceChat and source Electron fixtures. Tests prove
   startup readiness precedes the first message, no automatic response/usage,
   early-message reuse, cancellation, hidden/unbound isolation and renewal.

Commands: `node --test tests/device-realtime.test.mjs` in the demo, `npm test`
at repository root, and `npm run device:test` in the demo with local fixtures.
Do not run real paid sessions or build commands.

Protocol reference:
https://help.aliyun.com/zh/model-studio/fun-audiochat-client-events
