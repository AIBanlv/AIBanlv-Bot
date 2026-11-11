# Codex conversation continuation

## Objective

An authorized bound phone can reply "继续" after a Codex report and start the
next turn in the same thread. The user approved the single-task default on
2026-11-11. Multiple-task selection UI in Control is deferred.

## Contract and boundaries

- Preserve `send_text`, its binding proof, request correlation and replay guard.
- Add Codex-only `operation: 'continue'`, with `task` and optional `taskId`.
- Resolve an omitted ID only from a unique task reported or queried in the current
  device/account/tenant/role context. Multiple candidates require clarification.
- For a thread owned by the original desktop window, invoke the connected CLI's
  `queue --thread <id> --message <text>` using argument arrays and `shell: false`.
  Return `status: 'queued'` without a turn ID. Queue success does not prove that
  the original window received or executed the message. External task monitoring
  and approvals remain with that window, including while its current turn runs.
- For a companion-owned thread, resume with `excludeTurns: true` and start a new
  turn. Preserve history and the existing local approval handling.
- Never create a fallback thread, acquire an external thread's writer, steer an
  external turn or automatically retry an uncertain submission. Context loss
  cancels dispatch authority.
- No mobile/backend changes, dependencies, packaging, production model sessions
  or commits are required.

## Structure and style

ES modules under `demos/web-desktop-pet/electron`, Node test runner under
`demos/web-desktop-pet/tests`. Follow existing camelCase, single quotes and
injected transport fixtures, for example:

```javascript
await client.continue(taskId, task, { signal, scope, isCurrent })
```

## Plan and acceptance

1. Reproduce continuation rejection; implement adapter resume/start, turn-scoped
   approvals, busy/unknown-result guards and concurrent submission exclusion.
2. Connect scoped reports, single-task resolution, semantic/tool contracts and
   dispatcher execution. Preserve ordinary chat and remote authorization.
3. Verify the phone text path against local fixtures, run full Node regression,
   review the diff and record exact results here.

All three implementation steps are complete. Existing unrelated edits in
`device-main.mjs` were preserved. The root task plan belongs to separate work
and was left intact.

## Commands and testing

From `control-windows`, use Node 24+ on PATH:

- Full suite: `npm test`.
- Focused (from `demos/web-desktop-pet`):
  `node --test tests/device-codex.test.mjs tests/device-task-routing.test.mjs tests/device-task-dispatcher.test.mjs tests/device-task-permissions.test.mjs tests/device-realtime-routing.test.mjs`.
- Diff hygiene: `git diff --check`.
- Test same-thread history, approvals, stale events, abort/context change,
  multiple targets, replay, authorization rejection and uncertain results.
- The repository permits source verification only; do not build installers.

## Verification (2026-11-11)

- Regression tests first reproduced the missing continuation interface.
- Root `npm test`: 898 passed, no failures or skips, using the existing
  `.codex_tmp/node24/node-v24.11.0-win-x64` runtime on this workspace's PATH.
- `DEVICE_TASK_PERMISSIONS_ONLY=1 node tests/device-electron.mjs` from the demo:
  passed actual main-process/local-dialog verification, including continued
  external-turn approval and rejection of a different external turn.
- The local phone fixture exercises the real channel, reply bridge, text
  conversation, Harness and child-process Codex adapter. The Realtime fixture
  separately exercises the actual semantic router and tool dispatch.
- Code review covers context revocation, turn identity, approval scope, stale
  rollouts and duplicate/uncertain submission. `git diff --check` passed.
- No production phone/account/model session, cloud speech or original Codex UI
  live-refresh behavior was tested. No executable package was built.

## Live failure and correction (2026-11-11, 09:34)

The production local log confirmed both the query and "继续" entered
`route=conversation enabled=false`, with `calls=0 executed=0`. The prior fixture
had enabled Harness and bypassed `DeviceConversation`, so it missed the actual
disabled-assistant configuration. The spoken claim that all jobs were complete
was not an executor result.

- `DeviceConversation` now accepts an optional dispatcher getter. Exact Codex
  status commands and scoped continuations execute before the companion model
  route and return factual text events. They require remote authorization, but
  do not require a Harness Key, enabled assistant, speech or companion quota.
  Ordinary chat, notifications and creation retain their existing routes.
- `device-main` connects that getter and bypasses only the companion model
  preflight for these direct commands. Input diagnostics contain authorization,
  intent and character count, never the user's message or credentials.
- A status query selects the active tasks as continuation targets; when none
  are active it selects the latest task, retaining ties for clarification.
  Unknown and idle states cannot be described as successfully completed.
- The actual current chat's JSONL contained fresh event timestamps while its
  Windows file modification time was still 09:08. Rollout freshness now uses
  both values. A read-only check then correctly identified this current chat as
  `inProgress`, with no new model turn created.
- New regression tests first failed for disabled Harness, query/continue without
  model quota and preserved old file modification time. They now cover the
  actual conversation wrapper, phone channel, replay guard, authorization,
  target selection, cancellation and concrete executor errors.

The user stopped desktop automation with Escape and requested manual desktop
operation. The running source instance has not been restarted by the agent.
The local log subsequently showed a user-initiated restart at 09:47 and
`codex.ready`; no new phone query or continuation was observed at that check.
Root `npm test` passed all 903 tests with no failures or skips.
`DEVICE_TASK_PERMISSIONS_ONLY=1 node tests/device-electron.mjs` passed local
main-process approval and cancellation checks. `git diff --check` passed.
Phone-to-live-Codex delivery and the original desktop UI receiving or refreshing
the submitted turn still require live verification; a child app-server fixture
does not prove that UI behavior.

## Live writer conflict and correction (2026-11-11, 09:49)

The second phone screenshot and the local log show two distinct failures:

- At 09:49:40, annotated text `继续（来自安卓端仅测试）` was classified
  `directTask=false` and went to ordinary companion chat. The scoped direct
  matcher now also permits a trailing parenthesized annotation and preserves the
  full text. Unrelated story/chat requests, quotations and negations still do not
  match.
- At 09:50:00, plain `继续` reached the real adapter, but `thread/resume`
  returned `-32600: already has an active writer`. The original desktop window
  retains its writer even when its current turn ends. The old local fixture
  did not enforce this restriction, so its successful resume was insufficient.

Installed native CLIs (both the desktop copy and the connected npm copy) expose
`queue --thread --message` in their local `--help`. External continuations now
use that command through `device-codex-queue.mjs`; no second writer is acquired.
The helper reuses the connected launch's executable, environment and wrapper
prefix. It drains but never logs command output, bounds execution to 20 seconds,
and marks interrupted/timeout outcomes as uncertain. The adapter never grants
original-window approvals or synthesizes a new turn from a queue acknowledgement.
Writer-conflict errors also have their own accurate user message.

Regression coverage includes a real local queue child writing an inbox, full
phone-to-queue dispatch with disabled Harness and no model Key, replay and
authorization checks, exact annotated/untrusted text preservation, active and
completed external targets, cancellation, failed commands and unknown outcomes.
Companion-owned resume/start/history and approval coverage remains separate.
The distribution source list includes the new module; no package was built.

Live delivery remains a manual check: restart the source companion, query the
Codex task, then send `继续（来自安卓端仅测试）`. The phone should acknowledge
queueing; actual receipt must be verified in the original Codex window. No
production message was queued by the agent during automated verification.

Final verification: root `npm test` passed 910 tests with no failures or skips
using the cached Node 24 runtime. This includes a regression for context loss
after a successful queue acknowledgement: the already queued message cannot be
resubmitted as a supposedly cancelled request. Local
`DEVICE_TASK_PERMISSIONS_ONLY=1 node tests/device-electron.mjs` passed.
`git diff --check` passed. Original-window delivery awaits the user's live test;
the running source companion was not restarted by the agent.
