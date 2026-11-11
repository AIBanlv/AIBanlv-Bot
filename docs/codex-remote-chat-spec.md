# Remote Codex chat

## Objective and approved scope

On 2026-11-11 the user requested arbitrary phone messages, new tasks and subsequent
instructions, like directing Codex from the computer. The existing phone
`send_text` and authenticated desktop binding already carry the necessary text.
Implement this in the canonical desktop checkout; no mobile/backend changes.

An authorized phone device chat enters Codex directly, without a companion model,
Harness Key, model quota or a mandatory status query. Local desktop conversation,
reminders, greetings and existing direct file/screenshot transfer keep their routes.
The remote Codex route does not require the desktop avatar to be visible or loaded.

## Contract

- Main marks only authenticated remote user text with private `remoteCodex: true`.
  A model/tool call cannot set this flag through the Harness task schema.
- `HarnessTaskDispatcher.sendRemote(text, options)` delegates to a dedicated
  `RemoteCodexChat`. Options carry `allowComputer`, `sessionId` and cancellation.
- The remote router checks the current bound owner/tenant/device/role. State is
  bounded, memory-only, per scope and phone session. Rebinding clears it, including
  already displayed task/project choices and pending instructions.
- Automatically discover targets on first ordinary message. Choose a unique active
  task, or the uniquely most recently updated finished task. Ties and multiple
  active tasks present numbered choices. A selected task stays pinned across turns
  and unrelated reports; never silently redirect if it disappears.
- `任务列表`, `切换任务` and existing explicit Codex status queries display up to
  ten recent choices with title, project and status. `选择任务 N` resolves only the
  displayed snapshot. A pending instruction is sent once after selection.
- All other text is preserved as task input, including questions, negations, quoted
  strings, code and newlines. Existing adapter length limits remain.
- `新建任务：<instruction>` / `创建 Codex 任务：<instruction>` starts a new thread.
  Require a colon or whitespace before the description; questions such as
  `创建任务是什么意思？` remain ordinary input.
  Use the selected task's local project, otherwise the configured project or unique
  available local workspace. Ambiguous projects require `选择项目 N`; retain the
  instruction. Never treat a phone-supplied path as a trusted workspace.
- No existing task: use the same project-selection flow to create a new task.
- External tasks use native queue. A running companion-owned task may also queue
  an additional message; a finished owned task uses resume/start. Preserve provider
  approval policies and report queued/accepted separately from completed.
- The existing remote request replay guard remains authoritative. Timeout/unknown
  submission has no automatic retry. Check context before every effect.

## Structure and style

ES modules in `demos/web-desktop-pet/electron`, Node tests in its `tests`.
Extend the distribution file list for new runtime modules; no dependencies.

```javascript
await dispatcher.sendRemote(text, { allowComputer: true, sessionId, signal })
```

Use existing single quotes, camelCase, dependency injection and real local child
fixtures. The new router owns target/project decisions; Harness model planning is
unchanged. Direct phone-to-Codex requests use Codex's existing provider approval.

## Verification and commands

From `demos/web-desktop-pet` with the workspace cached Node 24 on PATH:

- Focused: `node --test tests/device-codex-remote.test.mjs tests/device-codex-continuation.test.mjs tests/device-codex-queue.test.mjs tests/device-conversation.test.mjs`
- Local main process: `DEVICE_TASK_PERMISSIONS_ONLY=1 node tests/device-electron.mjs`
- Full regression from repository root: `npm test`
- Diff hygiene: `git diff --check`

Test arbitrary input without querying, active/finished target discovery, stable
selection across turns, numbered ambiguity, new-task/project choices, scoped
cancellation, stale choices, no quota, replay, missing authorization and local
conversation isolation. Include a real local queue child and app-server fixture.
No automated production model session, real task, Computer Use, installer or commit.
User performs final live checks after restarting the source companion.

### Verification results (2026-11-11)

- Cached Node v24.11.0, repository-root `npm test`: 927 passed, zero failed,
  skipped or cancelled.
- Focused router/conversation/real child integration: 22 passed. The two final
  avatar-gate and creation-question regressions failed before their fixes.
- `DEVICE_TASK_PERMISSIONS_ONLY=1 node tests/device-electron.mjs`: passed the
  actual main-owned authenticated phone route, no companion quota/loaded avatar,
  local chat isolation and existing native permission checks. Local fixtures only.
- Runtime distribution allowlist includes both queue and remote router modules;
  `git diff --check` passed. No dependency or installer changes.
- Earlier live phone `继续（来自安卓端仅测试）` reached the original desktop
  conversation. Live arbitrary text, creation and numbered selection after these
  changes remain for the user to verify after restarting the source application.

## Boundaries

Always preserve binding verification, scope checks, replay guards and truthful
acknowledgements. Ask before unrelated protocol/dependency/deployment changes.
Never log message contents/credentials, enable shell evaluation, bypass provider
approval or replace another task's incomplete plan.

## Mobile tool selector - 2026-11-11

The authorized companion mobile change adds optional `send_text.remoteTarget`:
`codex`, `deepseek`, `harness` or `workbuddy`. Explicit targets require verified
computer authorization for ordinary input too, bypass text classification and
never fall back to another provider. Omitting the field preserves the existing
authenticated phone-to-Codex route. Request replay identity includes the target.

`sync_history` snapshots now add a safe `remoteTools` catalog. A `send_text` with
empty text and `operation: 'sync_tools'` returns a snapshot with `toolsOnly: true`
and no history; it starts no model turn. Current Java forwarding preserves both
fields without a backend change. New mobile clients require this capability;
old desktop versions show update-required status.

`RemoteTools` owns the provider boundary, bounded DeepSeek text history and
availability. Codex uses the existing scoped conversation router; Harness uses
its existing enabled adapter; WorkBuddy supports task creation and is visibly
labelled as such. Binding/role loss invalidates pending requests and history.
No install, shell, provider approval or permission-policy bypass was added.

Verification: demo `npm test` 939 passed; actual main-process Electron fixture
passes all four explicit targets and authorization checks. Mobile specification,
UI checks and outstanding user live checks are recorded in
`F:/zhanlvAndroidSdk/control/docs/remote-tool-selector/verification.md`.

## Live receipt and submission verification - 2026-11-11

The updated mobile app was built and installed on V2217A at the user's request.
An ordinary test message sent from that phone reached the intended existing
Codex conversation, which acknowledged receipt in the same conversation.
This verifies that delivery path; other providers, new-task creation and
multiple-task selection remain separate live checks.

Before submitting the source changes, repository-root `npm test` again passed
all 939 tests, without failures, skips or cancellations. Focused mobile
regressions passed all 16 tests; its existing unrelated iOS full-suite blockers
are recorded in the mobile verification document. No desktop installer was built.
