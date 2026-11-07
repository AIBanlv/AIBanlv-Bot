# DeepSeek Desktop Assistant

## Objective

The user approved internal integration on 2026-10-21: Control embeds pinned
official Harness modules and launches its own isolated Node worker over ACP.
The only required setting is the DeepSeek API key. Realtime keeps the current
character, voice, billing and LAM playback. No Harness UI, workspace picker, arbitrary shell,
general file writes, uploads, desktop screenshots or mouse/keyboard automation.
The approved 2026-10-22 extension adds confirmed application launch, reversible
desktop organization, read-only IMAP and local incoming-count notifications.
Contracts: `assistant-actions-map.md` and its linked module specifications.

## Contract

- The controller accepts a DeepSeek API key. Default storage is memory only;
  optional persistence uses Electron safeStorage. No key in renderer snapshots,
  URLs, prompts, logs, command arguments or checked-in configuration.
- Saving the key enables one Qwen function, `computer_task`. Completed
  function calls invoke Harness once and return bounded JSON tool results.
  Touch and remote controller messages cannot initiate computer operations.
- One Harness session and one task at a time. Stop, hide, role/account changes,
  disablement and quit cancel pending operations. Late results cannot start a
  new realtime response. No automatic retry of uncertain OS operations.
- Harness runs with a private home and directory. A fixed embedded composition
  omits shell and mutable filesystem tools and exposes only Control's local
  tools plus Harness web search/fetch. A second execution allowlist fails closed.
- Local tools open an existing directory, open a public HTTPS URL, and read a
  bounded UTF-8 text file. Each local operation requires explicit native
  confirmation showing its exact target. File contents are disclosed to
  DeepSeek only after confirmation. Network files, devices, credential locations
  and unsupported types are rejected. No browser login/session attachment.
- The runtime exposes eleven tools including installed-app discovery/launch,
  desktop plan/organize/undo and mail list/read. Only desktop organize/restore
  can move files, after full-list confirmation and persisted recovery metadata.
  Application paths and desktop locations are discovered on the current PC.
- Mail uses one QQ/163/126 account configured only by the trusted controller.
  Credentials never enter the Harness process. Header/body sharing requires
  native confirmation; bodies are untrusted plain text, with source/coverage
  information. Local opt-in polling does not call an LLM. No mail writes or SMTP.
- Use DeepSeek's existing search and public HTTP fetch providers for retrieval;
  the model summarizes retrieved text and includes sources. Search and model
  inference use the user's key, separately from Control realtime billing.
- No external Harness installation, executable, directory selection or runtime
  discovery. Official npm modules are pinned in the app manifest and lockfile
  and copied with the app. The worker runs with Control's own executable.
  Missing modules fail visibly; never install packages at runtime. User data
  stays out of Git. Clearing the key disables the assistant; restart requires
  saving again to activate an optionally remembered key.

## Implementation

Existing Electron 44.9.0, ESM and Node test runner. ACP library matches Harness's
declared dependency. Code belongs in `demos/web-desktop-pet/electron/`;
tests in its `tests/`; dependency packaging in `electron/device-package.mjs`.

The fixed MCP client override to `2.3.0` addresses GHSA-6prh-2h8m-c8cw in
Harness's transitive dependency; Control does not mount external MCP servers.

Style follows existing device modules:

```js
const result = await assistant.run(task, { signal })
if (signal.aborted) return
```

## Verification

From `demos/web-desktop-pet`: focused `node --test tests/device-assistant*.test.mjs`
and `node --test tests/device-realtime.test.mjs`; real child-process ACP fixture;
an embedded Harness handshake and a loopback model fixture, without real keys.
From root: `npm test`. Electron local fixtures verify settings, IPC origins,
text/voice function calls, cancellation, private data and responsive layout.

Always validate IPC, model output and process/network messages. Never modify
sibling repositories, contact billable APIs in tests or claim live API success
from fixtures. Preserve existing binding, billing, microphone and touch behavior.

## Sources

- Qwen client events: https://help.aliyun.com/zh/model-studio/fun-audiochat-client-events
- Qwen server events: https://help.aliyun.com/zh/model-studio/qwen-audio-realtime-server-events
- ACP: local Harness `packages/acp/acp/src/` and its behavior tests.
- Embedded boot: local Harness `packages/boot/app-boot/src/index.ts` and README.
- Worker executable: https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node
- MCP client fix: https://github.com/advisories/GHSA-6prh-2h8m-c8cw
- Electron: https://www.electronjs.org/docs/latest/api/safe-storage
- Electron: https://www.electronjs.org/docs/latest/api/shell

The shipped Qwen tools schema nests the definition under `function`; it is not
the flat OpenAI realtime schema. Real model access remains a manual acceptance
check with the user's credentials.
