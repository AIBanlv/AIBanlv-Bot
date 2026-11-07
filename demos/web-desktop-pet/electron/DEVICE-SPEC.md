# Control Device Edition

## Desktop Billing and Hardware Trial (2026-11-07)

This revision supersedes the guest identity and balance gates below. Unbound
devices may use 800 trial credits for public online roles. The billing identity is
a versioned SHA-256 fingerprint of Windows hardware UUID or macOS IOPlatformUUID;
the random installation/pairing ID stays unchanged. Raw UUIDs are not transmitted
or logged. Hardware lookup failure requires binding or the user's own model;
there is no random fallback. A forged hardware fingerprint remains an accepted risk.

Before guest status/session requests, the main process registers the fingerprint
through the new `/client/desktop-public/guest/identity` endpoint, using an HMAC of
the installation ID and fingerprint with the current pairing token. The server
stores an immutable installation-to-hardware mapping in a new table and reuses the
hardware ledger across reinstalls. Old clients without registration receive
`GUEST_HARDWARE_REQUIRED`. Apply the server's `docs/desktop-hardware-trial.sql`
before deploying the server and updated client.

Binding transfers the remaining trial once per account: spending 120 of 800
credits leaves 680 to claim. Late usage debits the original recipient, and repeated
binding cannot mint another gift. A claimed hardware identity requires login on
all installations (`GUEST_LOGIN_REQUIRED`). Local roles use the user's own model.

The metered server requires at least 30 available credits before session creation
and each response: wallet balance minus all received, unsettled desktop usage.
Exactly 30 is allowed. The client applies the same threshold to its known balance
and displays the server's authoritative rejection. Only one unfinished supplier
round per tenant or guest hardware may run across desktop sessions (`DESKTOP_SESSION_BUSY`).
Finished sessions with missing terminal usage retain the existing known-usage
settlement and allow further conversations. No administrator approval is involved.
This single-instance gate does not reserve funds or guarantee against one-round
overspend or missing-receipt underbilling. Shared mobile routes are unchanged.

Focused Node hardware/registration checks and `node tests/device-guest-electron.mjs`
passed. The Electron fixture checks an initial 800 credits, 680 after consumption
and restart with a new installation ID, then 560 after the additional text-page
live turn and a working account conversation after binding. It uses a fixed hardware
stub and local HTTP/WS; no production models, database, packaging or full suite was run.

## Settings Transcript And Harness Router Bounds (2026-11-07)

The controller text-chat page receives the same live user/assistant snapshots
and terminal/reset events as the pet. Main adds the current role and opaque
account scope; no PCM, expression tracks or hidden reasoning go to the controller.
The view replaces streamed rows by request and role, retains events received
during history loading, bounds its feed and discards mismatched role/account
events. Reopening online/guest chat merges locally pending history through the
existing memory restoration path instead of showing only stale server history.

Read-only Harness classification prompts include instructions and bounded recent
context, and therefore use a separate 16,000-character internal transport budget.
Count JSON escaping and drop oldest context if necessary; retain the entire latest
request. Ordinary executable tasks and validated route task fields retain their
2,000-character limit. No tools are enabled in the classification worker, and
failure/cancellation never falls back to executing an uncertain instruction.
Drive-opening uses the existing absolute-folder tool; no arbitrary shell is added.
Subagent/Schedule default integration is evaluated, not enabled, in
`../../../docs/harness-extension-assessment.md`.

Verify using real embedded Harness with a loopback model and substituted OS
opener, plus the existing local Electron guest fixture and settings browser.
Do not create production model sessions, real reminders or installation packages.

## Desktop Guest Trial (2026-11-06)

An explicitly connected, unbound device can use public online characters with the
existing server's 800-credit trial. Unknown/offline/bound identities never fall
back to guest access. `POST /jwt/client/desktop-public/guest/status` takes the
stable installation hash and returns `{ anonymous: true, score }`; `/sessions`
uses the realtime request without tenant/user/voice overrides. Both omit JWT and
cookies. The server resolves the public character's voice and returns a short-lived,
single-use relay ticket for `/ws/control/desktop/guest-realtime`. Guest responses
must declare `anonymous: true`; account sessions keep their existing strict contract.
No supplier key or client-reported billing is introduced. Trial exhaustion prompts
binding; previously logged-in devices must bind again. The account menu displays
trial credits and reuses its refresh action. Private roles and training still require
binding. Deploy the server's `docs/desktop-guest-nginx.conf` routes to the same
desktop instance before using this client; no SQL migration is needed.

Focused checks: `node --test tests/device-guest.test.mjs tests/device-model-settings.test.mjs tests/device-session.test.mjs tests/device-http-auth.test.mjs tests/device-score.test.mjs tests/device-pet.test.mjs` (65 passed).
`node --test tests/device-authoritative-usage.test.mjs` also passed (6 checks).
`node tests/device-guest-electron.mjs` passed with the real main/preload/windows:
guest balance, reply, exhausted quota rejection and switch to an authenticated
account, including closure of the old guest relay. It uses an isolated Electron
profile and local HTTP/WS fixtures, without supplier calls or production database.
Avatar rendering and speech inference are substituted, not verified by this check.
Per the accepted boundary, a balance refresh reaching zero may stop remaining
playback; no extra playback-preservation change is included. Earlier blanket rejection of
anonymous platform sessions below applies only to the original account route.

## Desktop Control Route Isolation (2026-11-06)

Windows connects to `/ws/control/desktop`, which retains desktop registration
proof and shares binding/message state with the unchanged mobile `/ws/control`.
Existing `PET_CONTROL_WS_URL` values ending in `/ws/control` retain their host
and are normalized to `/ws/control/desktop`; there is no fallback to the old route.
Deploy the server route and its Nginx forwarding before updating Windows.
Existing dedicated HTTP routes and paid-role creation checks remain unchanged.

## Authoritative Desktop Realtime Usage Revision (2026-11-06)

Windows bootstrap uses `/jwt/client/desktop/metered-realtime/sessions` (direct localhost
Java uses `/client/desktop/metered-realtime/sessions`). This desktop-only POST validates
the authenticated tenant's balance minus received, unsettled supplier usage
before issuing a grant, including cached retries. A nonpositive net balance
returns `402 SCORE_DEPLETED`; an unknown balance or unavailable database returns
503. The previous endpoint retains its positive-balance gate. The new relay
rechecks net balance before sending each response creation to the supplier.
Show `SCORE_DEPLETED` as the existing credits message; never fall back to an
unchecked endpoint or a user's local key. Pending costs use the original
whole-session rounding across this tenant's sessions. A round already in flight
can still exceed the remaining balance; no hard spending reservation is made.

The metered endpoint persists supplier receipts and in-flight intent in a server
directory retained across restarts. Completed known usage retries settlement with
the original session ID. If terminal usage is missing after supplier failure or
server restart, settle the supplier tokens already received and permit further
conversations. Missing last-round usage is an accepted accuracy gap; it does not
require administrator reconciliation. `503 DESKTOP_USAGE_UNAVAILABLE` reports
temporarily unavailable usage storage or balance lookup. Neither error changes
the funding source. The old endpoints do not enable this journal.

There is no administrator approval file or recovery-check endpoint. Windows
never submits billable tokens or fees. Client disconnect still leaves the server
collecting supplier cancellation usage for the existing five-second grace period.
Old servers' `DESKTOP_USAGE_UNRESOLVED` responses retain a retry message for compatibility.

Platform sessions now return `provider: control-realtime`, the existing native
Realtime model/voice/instructions/expiry, a session ID, and a 64-hex `relayTicket`.
The grant contains neither a provider `apiKey` nor a `billingTicket`; anonymous
platform grants and old provider-direct grants are rejected. Its only accepted
`wsUrl` is `/ws/desktop-metered-realtime`, resolved against the actual authenticated HTTP
origin. The main process connects with `X-Desktop-Session`, without provider
Authorization, and marks the session `authoritativeUsage: true`. It never opens
the historical client billing WebSocket or reports client token counts. Provider
usage is settled by the server relay; playback completion and interruption remain
conversation events. Own-key sessions keep their provider Authorization and have
no platform billing transport.

`PET_CONTROL_HTTP_ORIGIN` optionally selects an explicit localhost, 127.0.0.1 or
IPv6 loopback HTTP(S) origin for local validation; production remains
`https://scrm.ieasysell.com`. The authenticated adapter rewrites its existing
allowlisted production API routes, token exchange and public role catalog to that
origin, omitting the gateway's `/jwt` prefix for the direct local Java app. It
rejects arbitrary caller origins and keeps redirects disabled. The relay
uses WSS for HTTPS and permits WS only for that explicit loopback HTTP origin.
Use `PET_CONTROL_WS_URL` separately for the local control channel. Verify with
local fixtures only, without billable provider requests or package builds.

## Standalone Key Revision (2026-11-02)

`../../../CAPABILITY-MAP-standalone.md` and its three module specs supersede scan-required
startup and score-driven fallback. QR remains the only account login; local avatars and own
DeepSeek/Realtime work without an account or platform connection. Explicit source selection
survives scan/restart; errors never change funding source. Own Realtime has no billing transport.
Encrypted local transcripts retain account ownership offline, then upload after verified binding.
See `../../../docs/standalone-desktop-guide.md` for configuration, limits and migration.

## Direct Transfer And Remote Evidence Revision (2026-10-23)

See `../../../docs/direct-transfer-and-plugins-spec.md` for the three-repository contract.
The main process owns capture, picker, staged bytes and encrypted QR proof. A controller-only
renderer owns WebRTC; chunks require the active transfer id and bounded offsets. Only
authenticated mobile ticket holders may advertise readiness or answer. No TURN/upload fallback.
Remote evidence targets the server-provided originating session and never changes task success.
Explicit operations use the common Harness dispatcher before the conversation model speaks.
Evidence is not model chain-of-thought and is not evidence of a submitted background task completing.

## Harness Authorization And Unified Activity Revision (2026-10-23)

This user-requested revision supersedes historical per-operation prompts and
separate speech bubbles below. The desktop entry explicitly starts Harness with
automatic authorization for its existing restricted tools. Do not show a native
permission dialog or bring the settings window forward for each operation.
Retain cancellation, broker/session authentication, target revalidation,
read-only mail and the prohibition on reminder or touch tool execution. Explicit
commands from the currently authenticated mobile binding may use the same
Harness tools as local text and voice; retain owner validation and deduplication.
This is application authorization, not Windows administrator elevation; it does
not introduce arbitrary shell, installation, deletion or mouse/keyboard tools.
The settings page discloses task-directed file/mail sharing with the configured
model and conversation services. Codex and WorkBuddy approval workflows remain
provider-owned; do not bypass their safety policies.

Harness is labelled “已内置电脑助手” with the requested subtitle
“无需额外下载，模拟操作电脑一切任务”; the help text states the actual limits.
`DeviceActivity` owns the memory-only dialogue and task feed. Validated events
from the LAM relay add the user's actual text/voice transcription and the role's
visible reply. Stream snapshots replace one row in place, keeping turn order;
the status strip shows the most recently updated row. Hover or keyboard focus
reveals the shared scrollable log. Remove the old conversation/caption DOM and
do not render a second transcript from `DeviceChat`. Filter role directives only
for display, never alter audio, model input or backend reporting. Reset removes
private dialogue and rejects stale turn events, while plugin progress remains.
Verify with local fixtures and source tests only, without billable sessions or
building an installer.

## Unified Harness Dispatch And Account Menu Revision (2026-10-23)

Expose one `computer_task` entry for actionable user commands, with a provider
selector for desktop, Codex or WorkBuddy and create/status/interrupt operations.
Harness owns dispatch; model-directed agent tasks use the same router. Provider
project directories are selected by the local user and persisted, never supplied
by model output. WorkBuddy execution uses its installed CLI's stream-json print
mode, separately from the historical read-only task watcher below. Only explicit
terminal success counts as completion. Stream public progress and terminal state
to the shared activity feed and optional digital-human announcements; coalesce
stale queued progress before speaking completion. Never display hidden thinking.
Codex initialize opts into experimental APIs; capture bounded redacted stderr so
local data-directory access failures do not masquerade as generic network errors.

Persist Harness enabled state only alongside a system-encrypted remembered Key.
Automatic voice connection is quiet; show actual failures only. Wait for a valid
ASR result after audio commit, keep capture alive on recoverable recognition or
transport errors, and never replay an uncertain task automatically. Authorize WS
with the supported transport headers and maintain bounded heartbeat/reconnect.
The composer uses the activity strip's dark glass background with no scrollbar;
the speaker toggle must set actual output gain to zero and restore prior volume.

Place the account menu at bottom-left, replacing the old local-workspace label
and bottom exit button. Show server-confirmed name/points only; missing points
are unknown, not zero. The current backend supplies neither account metadata nor
device-initiated unbinding, so explain missing metadata and direct users to the phone
for an actual unbind. The latest user request defines the menu action “退出登录”
as closing the software: reuse the controller-only quit command without a binding
or server-capability gate. Stop active work and close both windows and the tray;
retain device binding and saved settings, and do not log out of the user's Codex.
Do not change the backend in this revision. Windows updates now follow
`../../../docs/windows-online-update-spec.md` (2026-10-27): a default HTTPS feed,
verified download and user-triggered exit/install, with PET_DESKTOP_UPDATE_URL
as an administrator override. A missing/failed feed never means up-to-date.
Align Codex and WorkBuddy announcement toggles in their plugin cards.

## Assistant Log And WorkBuddy Task Watch Revision (2026-10-22)

Two things were missing, and both were the same thing: the app could tell the
user what kind of failure happened but not which one, and it knew nothing about
the work happening on the same machine.

**The log.** Provider wording is deliberately kept off the screen — it can carry
credential fragments — which left "DeepSeek rejected this Key" as the only
answer to a question with six possible causes. `AssistantLog` writes NDJSON to
`assistant.log` in the profile directory: boot, the child's spawn parameters and
environment names, session establishment, each tool call, every failure with its
classified code, and the provider's original sentence after `redact()`. The
scrubbing is what makes the file safe to hand to someone else: `sk-` keys,
`Bearer` tokens, JWTs and long hex blobs become `sk-***(35)` and friends, while
`Authentication Fails … is invalid` survives intact, which is the entire point.
Rotation keeps two generations under 256 KB, and every write is best effort —
logging must never become the reason an assistant task fails. The controller
gains a "诊断日志" panel that shows the tail in place and opens the file with
the shell, because asking a user to find AppData is itself a bug.

**The watch.** WorkBuddy already writes everything it does to this machine:
`tasks/<session>/<n>.json` for the agent's task list, and
`projects/<workspace>/<session>.jsonl` for the run itself, line by line. Reading
those is a local integration, not a cloud one, so `WorkBuddyBridge` needs no
token, no plugin and no configuration. It follows each stream incrementally from
a recorded byte offset, leaves a half-written trailing line for the next pass,
and re-reads from zero when a file shrinks.

The interesting rule is what is worth interrupting for. `AskUserQuestion` is
recorded the moment it appears but only announced once it has clearly waited
(`settleMs`); a question that is answered in the same breath stays silent.
Replies are throttled per session, and the first pass establishes a baseline
instead of announcing months of history — otherwise starting the app would flood
the pet. Events reach the same queue backend reminders use, so they speak in the
applied role's voice and wait their turn.

Control is deliberately honest. An answer is written to
`~/.workbuddy/wb-bridge/answers/<callId>.json` for a WorkBuddy-side hook or
skill to consume, and the console can open the task's directory. The desktop
does not pretend it answered WorkBuddy, and never writes to WorkBuddy's own
files.
## Email Registration Revision (2026-10-23)

`../../../docs/account-registration-spec.md` adds email registration inside the
existing password-login entry. Main reuses Control's `/client/website-auth`
GET code/register contract, validates email, four-digit code and matching 6-50
character passwords, bounds response bytes and time, and discards returned
tokens/tickets. Only a successful registration (including the service's fixed
account-created/internal-login-failed response) proceeds to the existing
password login and device-confirmed binding. Later failures preserve the
account-created result and return the UI to password login with its email.

Code sending, registration and login share one cancellable job. A successful
code request starts a memory-only sixty-second resend deadline that survives
entry switching/reload, not process restart. Hiding, navigating, disconnecting
or exiting stops client waiting, never rolls back server account creation or
binding. New IPC is controller-main-frame-only; no production tests, backend
changes, dependencies or package builds are included.

## Assistant Key Normalisation Revision (2026-10-22)

`KEY_REJECTED` was honest but misleading: the Key really was refused, and the
only advice available was to check it at the DeepSeek console. The Key is typed
by hand or pasted from somewhere, and the usual paste carries a wrapper — the
quotes of a JSON string (`"sk-…"`, including the curly quotes a chat window
produces), the `DEEPSEEK_API_KEY=` of an `.env` line, the `Bearer ` of a request
example, or the line break of a value copied from a wrapped paragraph. Every one
of those is printable ASCII, so `validateKey()` accepted it and
`AssistantSettings` stored it as given; the provider then answered
`Your api key: ****ted" is invalid`. The message blamed the Key for what was
only the pasting.

`normalizeKey()` now runs before validation, in both directions of travel:
`configure()` normalises whatever was pasted, and `load()` normalises a Key that
an earlier build wrote verbatim (in memory only — the file is rewritten on the
next explicit save). The wrappers nest, so the strip repeats until it stops
changing; whitespace and zero-width characters are removed outright because no
Key contains them. Normalising before validating also closes a hole: a wrapper
can no longer pad a short value past the length rule. An empty or
whitespace-only field still means "keep the current Key", so re-saving the other
toggles never demands the Key again.

Since a wrong character count is the only visible trace of a bad paste,
`snapshot()` exposes `keyHint` — the first three characters and the length,
enough to recognise and useless to anyone else — and the settings placeholder
prints it. The Key itself never leaves the process.

## Assistant Failure Diagnosis Revision (2026-10-22)

Every way the DeepSeek assistant could fail used to end in one sentence: "check
the network and the Key". That was true of the code as written —
`AssistantProcess.run()` collapsed everything that was not a cancellation or an
empty answer into `HARNESS_UNAVAILABLE`, and `assistantMessage()` had no entry
for any `HARNESS_*` code, so all of them fell through to the same fallback. A
rejected Key, an empty balance, a blocked network and a dead harness process were
indistinguishable, and the only advice on screen was wrong for three of them.

The provider's wording is the only thing that survives the ACP boundary — the
structured error code does not — so it is read once, matched against a table, and
discarded: `classifyHarnessFailure()` turns it into `KEY_REJECTED`,
`PROVIDER_QUOTA`, `PROVIDER_BUSY`, `PROVIDER_MODEL`, `PROVIDER_REQUEST` or
`PROVIDER_UNREACHABLE`. The text itself is never forwarded, because it can carry
credential fragments; only the code escapes. A stalled turn is remembered as
`HARNESS_TIMEOUT` before the child is closed, since the ACP request only reports
a closed connection and "the component failed to start" would send the user
chasing the wrong fix.

Two smaller defects had the same symptom. `continueTools()` threw plain `Error`s
from its guards, so `assistantMessage(undefined)` produced the blanket sentence
for its own validation failures — each guard now names its own code. And the
argument check demanded `Object.keys(args)` be exactly `task`, so a model that
added any key of its own was refused outright; only `task` carries meaning, so
extra keys are ignored while every limit on the text stays.

`AssistantService.verify()` backs a new "测试连接" button, which spends one small
real request to report the Key, the network and the account's access to the
current model before the user asks the pet to do anything.

## Shared Transcript And Proactive Reminders Revision (2026-10-22)

The desktop used to receive `send_text` and answer it locally, which meant the
conversation existed in exactly one place: this process's memory, gone on
restart. The durable row already lives server-side — `ControlReplyHistory` in
live-broadcast-java persists every finished `assistant_reply` under
`tenantId + controllerUserId + deviceId + agentId` — so the device only had to
start reporting. Two new modules do that.

`DeviceRemoteReplies` turns each turn into a stream of `assistant_reply`
messages on `/ws/control`. Streamed frames carry `finished: false` for live
text; the final frame carries `finished: true`, which is the only thing the
server stores, so it goes into an outbox and is retried every two seconds until
`reply_saved` confirms it or five minutes elapse. Because the last frame is the
valuable one, `reply_saved` is also what clears it. A `sync_history` request is
answered with a snapshot (`snapshot: true`, `protocolVersion: 2`) of up to forty
in-memory rows, deliberately answered even when empty: that acknowledgement is
what separates a restarted device from an old executable that cannot answer at
all. Local turns are reported too, with `source: 'device'`, so the app sees the
voice and touch conversations it could not type. Everything is scoped to a
`context` snapshot and dropped the moment the owner, tenant, device or role
changes — history never outlives the binding it was created under.

`DeviceNotifications` handles the reverse direction. `ProactiveMessagePlan`
deliveries arrive as `proactive_message` with `useCurrentAgent: true`, and the
device must read them in whatever role is applied rather than the plan's source
role. Each `eventId` plays once, anything older than ten minutes is dropped, and
a reminder that arrives while the pet is talking or before the avatar is ready
simply waits. The spoken prompt wraps the backend content in a short
instruction, which is why `DeviceRealtime.send()` relaxes its limit to 1400 for
`notificationEventId` turns and why those turns emit no `user` event: the
wrapper is directions to the model, never something the user said. The
`preparing` event now carries `spoken: true` and `notificationEventId` so a turn
started elsewhere still plays through the LAM/audio bridge and is reported as a
reminder rather than as something the user typed.

## Full Duplex And Conversation Memory Revision (2026-10-22)

Speech used to be half duplex: `DeviceVoice` paused capture whenever the pet
was busy, so a reply could only be ended with the send button. `DeviceRealtime`
now has `interrupt()`, reached from the renderer through `controlDevice.interrupt()`
(`device:chat-interrupt`). It clears `this.turn`, sends `response.cancel` on the
live socket and reports `interrupted` — and nothing else: the authenticated
connection stays open, so the interrupting utterance reuses it instead of
minting another billable session. Billing stays single-ended because
`interrupted` and `output_completed` are both terminal, and a reply cancelled
before `response.created` produced no output and is not billed at all. `accept()`
drops late audio and text once `this.turn` is null, and `device-lam.mjs` treats
`interrupted` like `stopped` and releases inference. `DeviceChat.interrupt()`
clears the local reply before the new one starts, and the echoed `interrupted`
event only cleans up when its `requestId` is still the one on screen, so a
barge-in can never wipe the reply that replaced it.

The microphone stays open while the pet speaks, which puts the pet's own voice
in the room. `VoiceActivity.push(samples, guard)` therefore raises the bar while
`DeviceAudio.speaking` is true: three times the RMS (0.015 → 0.045) and half a
second of voiced audio instead of a quarter second. Residual echo that survived
`echoCancellation` cannot interrupt; somebody leaning in can. Typed input keeps
its explicit stop action.

Touch is an interruption too. `installTouchInteraction()` gained `onEngage`,
called before the first stroke is reported, and `device-pet.mjs` wires it to
`chat.interrupt()` while dropping `!chat.busy` from the figure's `canInteract` —
a hand on the pet outranks whatever it was saying instead of being ignored.
`DeviceChat.submit()` therefore accepts `voice` and `touch` while busy and
refuses everything else, which is what keeps the send button a plain stop.

Two bugs made an interruption look like a dropped conversation and both are
fixed. `accept()` used to throw on any `error` before checking whether a turn
existed, so the server's own cancellation receipt tore down a link the user was
already talking into again; it now only fails when a turn is open and the
`response_id` matches it. And `interrupt()` asked the server to cancel replies
that had already finished, which the server answers with an error; it now only
sends `response.cancel` when `turn.requested && !turn.done`.

`createDeviceSession()` now sends `tenantId` alongside `agentId`. Without the
tenant the server has no way to join the conversation this device already shares
with the app, so every restart began a brand new one; memory is scoped to a role
inside its tenant. The field is omitted rather than sent empty when the binding
carries no tenant. `syncConversation()`'s context key is
`deviceId + tenantId + owner + current profile + renderId`, not just
`agentId + renderId`, for the same reason: rebinding to another account must
rebuild the conversation instead of replaying the previous owner's context. The
owner is read from the channel because the snapshot scrubbed for the renderer
deliberately omits it.

Correction (2026-10-23): sending `tenantId` alone never restored model memory.
The session factory composed persona instructions without reading saved messages.
`device_history_request` now reads bounded account/role history over the bound
control socket. Realtime replays user/assistant items and waits for creation
acknowledgements before accepting the first question; DeepSeek awaits the same
history before its request. Guest context is encrypted locally and restored
after restart. See `../../../docs/conversation-memory-recovery.md` for scope,
limits and verification. Visible bubbles remain an independent, bounded view.

## Integrated Runtime Revision (2026-10-22)

This revision reconciles the parallel Windows branches and supersedes conflicting
historical behavior below. Keep AIBanlv branding, the removed debug/relay surface,
online role selection, startup waner replay isolation, the embedded assistant and
parallel local LAM warmup. Use the permanent 92px composer, microphone waveform,
300-440px control (360 default) and the online dot.

`setContext()` and `preconnect()` are the only session lifecycle: one cancellable
handshake shared with early messages, grant-expiry renewal and bounded retry.
`connection` events drive both readiness and the dot, including during a reply;
`preparing` starts turn playback without replacing the connection state. A ready
context keeps its connection without a second open/retry loop or timer. Hiding,
unbinding or switching identity cancels old work. Typed replies also request audio.

`device-mood.mjs` is the only idle head/pose director. It delegates the face to
`IdleExpressions` via `ambient` (rest) or `gaze` (aim) frames; captured mood gestures
own the face only while playing. Idle captures continue rotating without recent
repeats and release to gestures, touch and speech, then blend back. Touch remains
exclusive throughout its release animation. Role changes reset mood state, dragging
suspends the director, and click-through freezes the avatar. No absolute cursor
coordinates cross IPC. The old gaze controller is not restored.

Installer autostart uses the same parameterized installation identifier as the
uninstaller, targets `AIBanlv.exe`, and is removed only after successful uninstall.
Source verification never builds an installer without an explicit user request.

## Startup Default Revision (2026-10-21)

On each launch, immediately load the unique public `waner` (Shangguan Waner)
after confirmed online binding. This replaces the first-binding delay and
server-replay priority below. Ignore `agent_state_desired` snapshots while the
startup default is selected, including late snapshots after render readiness.
Explicit desktop selections and phone `switch_avatar`, `apply_agent_config`
or `distribute_agent` commands cancel pending initialization and take priority;
normal desired-state synchronization resumes after an explicit selection.
Repeated binding notifications must not reset a choice or duplicate the lookup.
Unbind/identity change clears the choice; the next binding defaults to waner.
Disconnect/exit cancels pending work. Keep default failures retryable and retain
the existing public catalog validation, voice and atomic download/render commit.
Verify immediate lookup, replay isolation, explicit-selection cancellation,
retry/rebind and real Electron startup using only local network fixtures.
No EXE or installer build is authorized by this change.

## Online Catalog Revision (2026-10-21)

`../../../docs/online-avatar-catalog-spec.md` supersedes the received-role-only
restriction. After a complete confirmed binding, main queries the existing
Control tenant catalog and exposes safe role labels to the controller. Own
private, tenant-shared and public profiles can be selected without a phone
push. Identity comes only from the control service; exclude cross-user and
cross-tenant private records. Cancel/clear on identity loss and ignore stale
responses. Use the normal bounded download/render/voice commit pipeline.
Backend API authorization remains required; no new login or token fabrication.
Source tests only unless the user explicitly requests a build.

## Online Dot Revision (2026-10-21)

The kept conversation used to announce itself with a permanent line of text,
`对话已连接`, sitting in the composer's status row for as long as the session
was open. A dot answers the same question at a glance: `#chat-link` leads the
status row, 7 px, green (`#3fd485`) when a session is open and the device is
ready, red (`#e2584f`) otherwise, with a slow breath animation that only runs
when the dot is green and respects `prefers-reduced-motion`.

`DeviceChat.link(online)` is the single source of that state, and online means
exactly one thing: the session reported `ready` **and** `this.ready` is true.
Everything else is off — `connecting`, a dropped or retrying session, an unready
device, and `update()` with `reset`, which drops the session even while the
device stays ready. The text line is then free to stay empty while things are
fine and only speak up when something is wrong; `对话已连接` is gone. The dot
carries `role="img"` with a 在线/离线 label instead of joining the two
`aria-live` regions, so a screen reader is not narrated on every reconnect.

Measured on the real window (`artifacts/device-debug/check-link.mjs`, port
9237): the dot is the first child of `.chat-status-row`, 7 × 7, `border-radius:
50%`, `rgb(63, 212, 133)` for online and `rgb(226, 88, 79)` for offline, the
status text is empty, `animation-name: chat-link-breath` only while online, and
no console errors appear.

## Captured Expression Library Revision (2026-10-21)

Idle expressions never really changed because the pet never played the
expression library. `AIBANLVKeyframeFace.json` (78 clips, 13 emotions × 6,
30 fps, 61 channels: 52 ARKit blendshapes plus head and eye pose) was only ever
consumed on the Java side for spoken replies — `ControlLamStream` loads it into
`KeyframeFaceLibrary` and `IosExpressionProcessor` turns a reply into a track.
The idle face was synthesised by `sampleTextAction()`, which writes about a dozen
channels and holds one flat shape for the whole action, so six of the thirteen
emotions were literally the same picture.

`electron/device-face-bank.mjs` now folds the library onto the 52 channels the
renderer understands and gives the pet clips to play:

- `buildFaceBank()` maps the library's PascalCase channels onto `names`, drops
  the head and eye-pose channels (the gesture layer keeps those), damps captured
  eye aim to 35 % so it cannot fight the cursor follow, resamples each clip to
  20 fps and quantises to bytes. 3.6 MB of floats becomes an 850 KB bank, built
  in about 45 ms. `npm run device` builds it once into `userData/face-bank.json`
  and only rebuilds when the library's mtime changes; a packaged install reads
  `runtime/control/AIBANLVKeyframeFace.json`.
- `createFaceBank()` is the renderer handle: it validates the payload, groups
  clips by emotion and `clip(emotion, seconds, random)` prefers one long enough
  to cover the gesture (otherwise the longest, and the action is cut to fit).
- The pet fetches `/device/face-bank.json` after the window is up and calls
  `mood.use(bank)`; `play()` picks a clip and a random start offset so the same
  emotion never opens on the same frames twice, and `target()` takes the 52
  weights from `sample(clip, offset + elapsed)` while `sampleTextAction()` still
  supplies head, gaze and depth.
- Everything degrades: no library file, a refused payload or a slow fetch simply
  leaves the synthesised face in place. `data-bank="clips|synth"` on the surface
  reports which one is active.

Measured on the real window, 24 s driven by the same gestures: with the library
197 distinct face shapes and 33 of 52 channels in use, without it 10 shapes and
6 channels. The bank is served as `{"status":200,"bytes":850363,"clips":78,
"fps":20,"emotions":13}` and no console errors appear.

## Parked Cursor Keeps Performing Revision (2026-10-21)

A cursor that stops moving used to hold the pet in one pose: the 50 ms
pass-through sampler kept refreshing `look.at` with the same coordinates, so the
follow never went stale and the head stayed locked on that direction while only
the sparse 5–11 s idle timer produced any change. `point()` now compares each
sample with the previous one (direction delta > 0.02 or distance delta > 24 px)
and only refreshes `look.at` on a real change; a parked cursor therefore releases
the gaze after `lookStaleMs` and the aim glides back to centre.

Being left alone then drives three things. `glance()` gives the pet a random
gaze target every few seconds while nothing owns the face, so the eyes keep
moving between actions. `schedule()` shortens the gap to 1.4–4 s when
`alone(stamp)` — system idleness above zero, or no pointer change for `stillMs`
(8 s) — and passes `wander: true` so `moodAction()` picks from the new
`wanderActions` (look left/right, look up, tilt, slow nod, rest) for 1.8–2.8 s
each; the mood presets still win whenever the mood is anything but calm, so a
sleepy or annoyed pet keeps its own character. And drowsiness is now a "nobody is
using the machine" signal rather than a "cursor parked" one: `pulse()` cancels
the drift while `idle === 0`, so working with the mouse parked keeps the pet
awake, and only a silent machine lets it doze off and stretch the gaps back to
5–10 s.

Measured on the real window with a parked cursor: about six expression changes
per 36 s while the machine is in use (mood calm, 117 distinct gaze targets), and
five per 40 s once the machine goes idle, ending sleepy.

## Wider Portrait, One-Line Composer And No Hover Tip Revision (2026-10-21)

The portrait was being squeezed into a column: at the old 300 px default the
canvas was 2.41 times taller than it was wide, so the figure lost its sides.
`policy.petSize()` now accepts up to 440 px (the 240 px floor is unchanged), the
size slider in `device-pet.html` and the controller runs 300–440 with a default
of 360, `DeviceWindows` starts at 360 and its control gate accepts the same
range, and the composer lost 20 px. At the new default the canvas aspect is 1.82,
so the figure keeps about a quarter more horizontal room while the vertical
framing — which is set by `camera.zoom` alone — is untouched.

`COMPOSER_HEIGHT` drops from 112 to 92: the textarea is `rows="1"` and measures
24 px, which is one 18 px line plus its padding with no clipping, while the
status row (14 px) and the action row (30 px) stay as they were. `main` grid
rows, `#avatar-host`'s bottom inset and `.caption-slot`'s offset all follow the
same constant, so the portrait still runs behind the card instead of being cut
by it.

The composer is now rounded on all four corners (`border-radius: 12px` instead of
`12px 12px 0 0`), reading as a floating card rather than a bar welded to the
window bottom. The hover tip over the portrait is gone: `#drag-surface` keeps its
`aria-label` for assistive technology but no longer carries a `title`, so nothing
pops up when the pointer rests on the figure.

## Eased Motion And Hover Transcript Revision (2026-10-21)

Idle motion no longer steps. `device-mood.mjs` keeps a single driver loop that
owns the face for as long as the pet is allowed to play, and every value it
sends is eased towards a target instead of being written outright: a full
52-channel weight vector plus the pose is advanced with a frame-rate independent
exponential approach (`weightTau` 0.14 s, `poseTau` 0.12 s) and written at
~30 fps (`emitMs` 24). That removes every source of the old "one jolt per
action" rhythm at once: an action used to snap its expression on and then snap
back to a hard `neutralExpression()`, and the renderer used to lose control
300 ms later and jump to its own idle animation. Now the pose stays `owned`
permanently while the pet is idle, so there is no handover to jump across; an
action ending simply eases its weights back to rest, and the cursor aim rides on
top of the action as an ordinary target change (the previous snapshot blend with
its 0.5 s quadratic fade is gone).

Two details keep the constant ownership from looking frozen: a slow `breathe()`
sine — scaled down to nothing while a real aim is active, so it never fights the
follow — and a blink scheduler that is written straight onto the output instead
of being eased, because a smoothed blink would never close. When another owner
takes the face (a reply, a preview, a touch) the loop releases once and waits;
it never writes a neutral frame that would fight the new owner.

The transcript stays out of the way: `.conversation` is `opacity: 0` and only
the hover (or keyboard focus) inside `.caption-slot` fades it in, so the portrait
and particles are clean until the pointer is over the bubbles.

## Screen-Wide Cursor And Spoken Text Revision (2026-10-21)

The pet now answers the cursor anywhere on the desktop, not only inside its own
window. `DeviceWindows.updateMouse()` already samples the system cursor every
50 ms for click-through; it also calls `publishPointer()`, which sends
`pet:pointer` with a normalised direction, a pixel distance, an `inside` flag and
`powerMonitor.getSystemIdleTime()` — never an absolute screen position — and the
preload exposes it as `desktopPet.onPointer`. `device-mood.mjs` turns that into a
damped gaze/head follow (`point()` plus a `look` rAF that stops writing frames as
soon as the target settles), while `classifyProximity()` in the policy module
turns distance crossings into one-off `approach` / `retreat` events and
`idleLevel()` grades system idleness into three dozing steps. Approved gestures
still win: a reaction action stops the follow, and the follow resumes when it
ends. `reactiveKinds` keeps quiet events (`retreat`, `blur`, `leave`) from
triggering an action.

The handover between the follow and an action is smoothed: `play()` snapshots the
current aim and `aimOn()` lets it ride on top of the action with a quadratic
0.5 s fade, so the head no longer snaps back to centre when a gesture takes over
(the same reason `pointerenter` waits 220 ms before reporting `hover` — sweeping
past the window must not jerk the pet). An expiring follow glides back to centre
before resting instead of stopping dead.

A parallel design for the same feature landed on `master` at the same time
(`electron/device-gaze.mjs`: `MouseAttention` + `installMouseFollow`, driven by a
`pet:cursor` channel that carried absolute `screenX`/`screenY`). The merge keeps
this one and deletes that one. Two directors that both write `pose.owned` frames
fight over the eyes and the head, which is exactly the jitter this revision
exists to remove, and the absolute screen position is more than the renderer
needs to know — `pet:pointer` sends a direction, and `tests/device-mood.test.mjs`
fails the build if an absolute coordinate creeps back into that payload. The
branch's speed-to-energy tuning notes are kept in
`../../../docs/mouse-follow-spec.md` for reference; its module, its tests, the
`pet:cursor` channel and the preload's `onCursor` subscription are gone.

The kept conversation is never allowed to lapse: a 30 s timer re-runs
`syncConversation()` even when no state event fires, and `submit()` reports
whether it reused the idle link, so the status row only says "正在连接" when a
link really had to be built and says "正在回复" otherwise.

Typed messages are spoken as well. `submit()` now always asks for
`['text', 'audio']`, `response.audio.delta` is no longer dropped on a text turn,
and `DeviceChat` prepares and plays the audio pipeline for every reply, so a
typed message produces the same voice and lip movement as a dictated one.

## Idle Mood Revision (2026-10-21)

When nothing owns the face, the pet behaves from local state only: no model call,
no network. `electron/device-mood-policy.mjs` keeps four Glitch-style internal
variables — curiosity, irritation, drowsiness and intimacy — pushed by Mochi-style
local gesture reading (press-less stroking, hovering, tap, double tap, long press,
swipe, window focus and silence) and drifting back to rest every second. Three
pokes inside 1.4s tip the mood to `annoyed`, silence grows `drowsiness` to
`sleepy`, stroking raises `intimacy` to `affectionate`. `moodAction()` maps the
mood, or an immediate gesture answer, onto the existing `src/text-motion.mjs` tag
library (head / emotion / gaze / depth) and `sampleTextAction()` renders it, so
idle behaviour and typed actions share one library and one renderer path.

`electron/device-mood.mjs` is the director: it watches `pointerenter`,
`pointermove`, `pointerleave`, window focus/blur and visibility, classifies
press-less back-and-forth motion as stroking, plays an action every 5-11s (longer
while drowsy) and rests on `neutralExpression()` afterwards. It only plays while
the window is visible, the avatar is ready, and no reply, action preview, live
touch, click-through or hidden state owns the face. Recognised touch gestures are
forwarded from `device-touch.mjs` through `onGesture`, independently of the reply
gate. Both modules are served under `/device/` and bundled.

## Kept Conversation And Transparent Composer Revision (2026-10-21)

The portrait is painted over the whole pet window instead of the grid row above
the composer, so the composer and its 112px row no longer crop the figure; the
camera zoom formula is unchanged, so the figure keeps its size and vertical
position. The composer is a transparent grey-white overlay with grey-white text,
placeholder, status and icons plus soft shadows, leaving particles and the
portrait visible behind it. The transcript scrollbar is a translucent 6px thumb
over a transparent track instead of an opaque bar. The bottom-left cluster is the drag grip, settings
gear, hide button and a 240-380px size slider; the role name is no longer
printed there. Reply bubbles are labelled with the bound role name, the role
bubble is pale white and the user bubble pale green at the same alpha.

A bound device with a rendered avatar keeps one authenticated conversation open:
`DeviceRealtime.open()` mints and handshakes the session before any message,
`submit()` reuses that connection, and only LAM preparation still runs per
spoken turn. Role switches, unbinds and offline states close the connection;
an idle session is replaced quietly on expiry and after a stop, with a bounded
backoff. `played()` no longer closes a kept conversation after the idle timeout.
`canConnect` gates reconnection on the real device state, and `session` events
(`connecting` / `ready` / `closed`) report lifecycle without starting a reply.

## First Binding Revision (2026-10-20)

Binding confirmation without a profile must not wait forever. Wait two seconds
for the server's desired profile, resend the existing `device_online` once to
request replay, and wait two more seconds. If no desired profile arrives, read
only the public tenant `1` catalog using Control's existing endpoint and select
the unique public `waner` (Shangguan Waner) record. Reuse Control's ZIP layout,
preserve the catalog voice, and use the normal download/validation/render path.
`electron/device-default-profile.mjs` holds that lookup behind
`loadDefaultProfile(signal, fetcher)`, so the wait and the fallback are testable
without a server. No profile is applied before server-confirmed binding; no
cloud conversation is started automatically. A server profile always
cancels/supersedes initialization. Unbind, identity change, disconnect and exit
cancel pending initialization. Failures are visible and retryable. No identity,
selected profile or ZIP is persisted across runs. Existing server-selected roles
take priority over waner. This public default is an explicit user-requested
exception to the original server-profile-only rule below. Default catalog lookup
has a 15-second timeout, 1 MiB response bound, fixed HTTPS origin and no redirect
or account credentials.

## Portrait And Meter Revision (2026-10-20)

The 120px caption row is removed from the grid. Bubbles and captions float above
the composer and the portrait keeps the full area above the card, shifted down
24px and capped at 2.2x device zoom. The role name, settings gear and hide button
form the bottom-left cluster; microphone and send stay at the bottom right.
The voice meter uses 36 two-pixel bars with three-pixel gaps, a green gradient,
a one-pixel baseline and an 18px maximum height, centered in the card; tests
forbid it from filling the input. Development builds resolve
`runtime.local.json` from the package root (`path.resolve(directory, '..')`)
because `app.getAppPath()` points at `electron/` when launched through
`electron electron/device-main.mjs`; a missing file silently falls back to the
documented environment variables and defaults.

## Composer Revision (2026-10-20)

The floating toolbar is removed. The pet is now avatar, bubbles/caption and a
permanent composer card, from top to bottom; the composer cannot be collapsed.
Inside the card the textarea sits on top, the role name at the bottom left and
the microphone/send buttons at the bottom right. Enabling the microphone
switches the card to voice mode and replaces the textarea with a local energy
waveform driven by captured RMS; it never records or uploads audio for the
meter. `devicePetSize` replaces the old 56px toolbar row with the 112px
composer, and the native hit region follows the same bounds. Status text is
confined to the card with ellipsis, so a long error never widens the pet.
Every renderer module must be listed in both the runtime `/device/` whitelist
and the package bundle; `tests/device-modules.test.mjs` enforces that pairing.
Installation stays per-user: the installer registers `ControlDeviceTest` under
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, leaves "Open Control
Device" checked on the finish page by default, and the uninstaller deletes the
value. Device identity and PATH remain untouched.

## Mouse Touch Revision (2026-10-19)

`../../../docs/mouse-touch-spec.md` adds local mouse/touch stroking with damped
head/gaze following and expression feedback. The avatar surface handles stroking;
the composer role name handles window dragging. Keyboard interaction remains available.
Conversation and action preview take priority; release/cancel restores idle motion.
The user subsequently requested spoken touch replies. Completed strokes now
use the existing authenticated Realtime/billing/LAM path after settling, with
deduplication and cooldown; microphone capture is not required. Automated
verification uses only local provider fixtures.
The gesture/location revision in the same spec replaces generic stroke prompts
with Control's tap/double-tap/hold/swipe/stroke classification and character-relative
face zones. Main validates structured events and constructs the observation prompt.

## Microphone Revision (2026-10-19)

The user approved direct voice conversation alongside the transparent text composer.
`../../../docs/microphone-input-spec.md` supersedes the earlier no-microphone scope:
explicit microphone toggle, local pause detection, bounded PCM input to the existing
Realtime conversation, half-duplex capture during replies, preserved text drafts,
scoped audio-only permission, and memory-only audio. Microphone defaults off and
never restores automatically. Other media permissions remain denied.

## Objective

Turn the desktop experience into a controlled device. The Control App scans
the desktop QR, binds through the existing service, and switches the real
avatar and its online voice ID together. Preserve both existing offline editions.

## Capability Map

| Module | Responsibility | Depends on |
| --- | --- | --- |
| device-binding | Persistent installation ID, server-issued QR, reconnect | - |
| device-avatar | Apply bound account's profiles, load ZIP, report actual readiness | device-binding |
| device-speech | Online voice from the applied profile, cancel on switch/unbind | device-avatar |

Build order: binding, avatar, speech. Microphone input was approved later (see
the Microphone Revision); unsolicited conversation is never included. Speech
must not fall back to an OS voice or an arbitrary default.

## Test Distribution Revision (2026-10-19)

`DISTRIBUTION-SPEC.md` supersedes the above-avatar bubble placement below.
The order is avatar, bubbles/caption, composer. A Windows x64 per-user
installer bundles the Python/LAM and Java/Control runtimes without private profiles.

## LAM Revision (2026-10-19)

`LAM-SPEC.md` replaces the amplitude-driven mouth limitation below with local
original-TAR inference, unchanged Control postprocessing and audio-clock playback.

## Realtime Conversation Revision (2026-10-19)

User selected Control's existing Realtime service and speech bubbles. This
supersedes the unavailable-chat/speech placeholders documented below.

- Keep both native windows and the composer directly below the avatar.
  User and assistant text appear in bounded, scrollable speech bubbles above
  the figure. Stream actual replies; render all text as text, never markup.
- Assistant bubbles additionally remove ASCII square brackets and their contents,
  including nested directives and incomplete streamed tails. Each event carries
  the full accumulated text; filter each snapshot independently. Do not change
  user text, provider history, speech or LAM input. Empty filtered snapshots must
  not create a bubble and must remove an earlier bubble if a final revision clears it.
- Main bootstraps the desktop-only session endpoint specified above on the existing Control
  origin with `provider: qwen-realtime`, the SHA-256 of the full canonical
  device ID, the applied agent/voice/language and a per-intent request ID.
  Request native Realtime (`speechFilterEnabled: false`), with no microphone.
- Preserve the requested voice ID in the applied profile. Before bootstrap,
  resolve CosyVoice/opaque IDs with Control's canonical `utils/voicePairs.js`.
  Query only stored metadata for the server-confirmed binding tenant and the
  backend's public voice tenants (1508290699769155584, 24, 1), using read-only
  `/jwt/client/Voice/searchAliyunVoiceByTenantId`. Do not synchronize or clone
  voices. Inspect all allowed scopes and reject duplicate selected aliases.
  Require a unique same-owner/name pair, send its Realtime database ID,
  and validate the grant against its actual provider voice ID. Native Realtime
  IDs bypass metadata lookup. Missing/ambiguous pairs fail explicitly; metadata
  failures retain a retryable service error. No arbitrary or system fallback.
  Lookup shares bootstrap's cancellation/timeout and has a bounded response.
- Validate the returned model, expiry, voice and WSS endpoint before using
  temporary credentials. Credentials/tickets remain in main memory; never in
  URLs, renderer state, logs or persisted files. Only known DashScope or the
  returned workspace's regional hosts receive the Authorization header.
- Register the existing signed-ticket billing producer before provider output;
  preserve session/output/usage/close events and sequence deduplication. Stop
  on billing denial/disconnection. No automatic resend of uncertain requests.
- Reuse Control's `session.update`, `conversation.item.create`, `response.create`
  and response-scoped transcript/PCM event protocol. Wait for `session.updated`.
  Bound text, audio, response duration, idle time and concurrent submissions.
- Renderer receives only sanitized conversation events and mono PCM; use Web
  Audio for actual 24 kHz playback, volume and stop. Any amplitude-driven mouth
  movement is a playback envelope, not a claim of TAR inference.
- Cancel and clear private dialogue on role/binding context changes. Late events
  cannot change the new role. Stop cancels generation and queued playback.
  Original action preview and online playback are mutually exclusive.
- Draft survives failed submission. Enter/Shift+Enter/IME behavior is preserved.
  Pending, interrupted, disconnected and error states are visible.
- No paid production request during automated verification. Test bootstrap,
  billing and provider with controlled transports, then real Electron bubbles,
  PCM playback, size/alpha/layout, cancellation, original controls and security.

Boundaries: do not change backend/native code or existing offline editions.
Temporary speech/conversation data is memory-only and cleared on context loss.

## Desktop Pet Revision (2026-10-19)

User requested the original separate control panel and transparent desktop pet,
with a text conversation composer directly below the avatar.

- Controller owns binding QR, received-role selection, original text/action
  controls and window settings. Reuse the existing text-action implementation.
- Pet is a separate frameless transparent window, draggable, hideable and
  pinnable with 240-380px sizing. Retain tray access to reopen the controller.
- Only the pet renders the avatar. Its actual ready event still commits the
  profile and voice atomically. Unbound/offline pets cannot display private roles.
- Permanent composer card below the avatar has a labeled textarea, the role
  name and microphone/send icons. Enter submits, Shift+Enter inserts a line,
  Chinese IME confirmation never sends. Empty/oversized requests are rejected
  in main. Errors retain the draft.
- The composer remains clickable in mouse-through mode; only the figure passes
  through. Transparent margins remain click-through. Both keyboard and mouse
  dragging work without stealing focus from text entry.
- The Realtime revision above supplies the bound-device conversation contract.
  QR tokens are not provider credentials. Do not send device-originated
  `send_text` to the controller-only route or fabricate replies.
- Text/action preview is not AI conversation and is not an offline voice
  fallback. The original offline editions remain unchanged.
- Closing the control panel hides it; tray/pet controls reopen it. Explicit exit
  closes both windows and disposes downloaded assets.

Verification adds geometry/hit-region tests and real two-window Electron tests
for input position, IME/Enter semantics, text retention, drag, focus, pin/size,
hide/reopen, mouse-through input, existing actions, secure IPC, QR and role sync.

## Stack And Structure

Existing Electron 44.9.0, ES modules, Node test runner, shared Three.js-based
LAM renderer. `electron/device-*` owns the native device edition;
`tests/device-*` owns protocol, security and actual Electron verification.
QR generation uses qrcode 1.5.4; archive validation uses yauzl 3.4.0.
Existing native projects, backend projects and model weights remain unchanged.

```javascript
send({ type: 'device_online', role: 'device', deviceId })
```

Use descriptive camelCase, single quotes and narrow named IPC methods.

## Commands

From `control/demos/web-desktop-pet`:

- Install: `npm install --ignore-scripts`
- Unit/integration: `npm test`
- Focused protocol: `node --test tests/device-channel.test.mjs`
- Runtime: `npm run device`
- Electron verification: `npm run device:test`
- Explicit live handshake only: `node tests/device-handshake.mjs`

## Contracts

- Online role creation uses the device-authenticated `POST /jwt/client/desktop/role-creation`:
  `{ operation, payload }` supports `role_upload`, `role_create`, `role_create_status`.
  One `role_create` trains the appearance, creates the voice and saves the private role on the server.
  The server checks a current paid package before upload tickets and creation; free credits do not qualify.
  Windows displays `PAID_PLAN_REQUIRED` / `PAID_STATUS_UNAVAILABLE` and preserves unknown-result jobs.
  Confirmed pre-admission payment rejection can be retried after renewal with the same request ID.
  Status lookup remains available after package expiry. Media upload still goes directly to Qiniu.
  Deploy the new HTTP path to one fixed Java instance because upload tickets remain process-local.
  Focused verification: `node --test tests/device-online-roles.test.mjs tests/device-http-auth.test.mjs`.

- Default control endpoint matches `control/api/request.js`:
  `wss://scrm.ieasysell.com/ws/control`.
- Device sends `device_online`, `pong`, `agent_state_report`.
- `agent_state_report.applyStatus` accepts only `unknown`, `applied`, `failed`,
  matching `MybatisControlStateStore.validApplyStatus`. Report `unknown` while
  applying a profile; downloading/rendering remain local phases, never wire
  statuses. Only actual render readiness reports `applied`; failures report
  `failed` with `lastError`. The local Electron fixture enforces the same set.
- Receive `bind_offer`, `bind_success`, `bind_lost`, `unbind`,
  `switch_avatar`, `apply_agent_config`, `agent_state_desired`.
- QR contains `type: bind_device`, `deviceId`, server `bindToken`, `expireAt`.
  Accept epoch seconds and milliseconds. Expired/offline codes are hidden.
- Server is the binding authority. Never restore authorization from a local
  Boolean, manufacture a binding token, or impersonate a controller.
- Reject other-device messages. Apply no profile or speech before binding.
- Keep `voiceId` verbatim with the role. Stop old audio on every profile change.
- Download/validate first, then load in an isolated iframe. Only the actual
  current iframe's ready event may acknowledge `applied`.
- Failed/stale downloads or render attempts must not become the current role.
- Bootstrap native Realtime with the applied role; the binding channel supplies
  identity/profile data, not cloud credentials. Remote `send_text` uses the same
  gated conversation path and returns a correlated error on failed submission.
  It must not echo user input as an `assistant_reply`.

## Trust Boundaries

External socket payloads, archive URLs, archives, renderer IPC and local HTTP
are untrusted. Only the configured WSS server can supply profiles. Main owns
network/files; the renderer is sandboxed and restricted to its private local
origin. HTTPS asset hosts are explicitly allowlisted, with redirects rejected.
Downloads have byte/time limits; archives have file-count/expanded-size/path
limits and must contain the required LAM assets. Never extract to disk.
Only an installation ID is persisted. Binding tokens stay in memory.
No secrets, account sessions, source archives or generated assets enter Git.

## Testing Strategy And Acceptance

Test binding gates, mismatched identities, QR expiry, heartbeat/reconnect,
profile versions, failed loads, canceled stale loads and unbind cleanup with
the real channel and controlled transport. Test archive/URL rejection before
network/file access. Runtime tests use an isolated Electron profile and a local
protocol fixture, real renderer, QR decoding, visible moving canvas pixels,
320/768/1024/1440 layouts and accessibility checks. Verify the real production
handshake without creating or binding a test account.

Always preserve existing demos and run their Node regression suite.
The user approved the existing Realtime service, not server authentication
changes, an additional provider or deployment.
Never claim live phone binding or audible cloud speech passed without evidence.
