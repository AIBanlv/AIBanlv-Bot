# Read-only IMAP Assistant

## 2026-10-30: opt-in new-mail content readout

The settings page now provides **新邮件内容播报**. It is off for new and legacy configurations;
count-notification consent is never silently upgraded to body sharing. Explicitly enabling it
allows the next checks to read at most the latest three newly discovered INBOX messages as
plain text. Encrypted remembered settings retain this choice; removing the account clears it.
The first check and UIDVALIDITY changes still establish a baseline without reading old bodies.
Ask “读出最新邮件的正文” for older mail or more content; tools must list and then read actual
issued message tokens, not infer a body from its subject.

Automatic speech includes sender, subject and a clearly labelled body excerpt (not the full
message), bounded to 180 body characters per message and 1100 characters per notice. It states
unread/unreported coverage and explicit body-read failures. URLs are omitted from automatic
excerpts; no HTML/resources/attachments are opened and IMAP unread state is preserved.
Bodies are not written into settings or the UID checkpoint. Only the bounded notice is shared
with the current conversation/voice service after opt-in; normal conversation charges can apply.
The operating-system notification remains count-only, independently controlled by the old switch.

Queued body notices are revalidated against the mailbox identity and current opt-in before
speech. Revoking it, changing accounts or stopping the mailbox prevents pending body disclosure.
Notification JSON is untrusted data and cannot authorize tools, reminders or other actions.
These rules supersede the count-only automatic notification boundary in the original spec below,
but retain TLS verification, read-only operations, size/time limits and manual token validation.

Validation uses synthetic mail only: baseline/no-body, opt-in reads capped at three, count-only
no-body, per-message failures, de-duplication, revocation during reads and queued speech,
persisted opt-in, HTML-to-text and bounded coverage. No real mailbox or paid model session is used.

## Objective and acceptance

User selected QQ/163-style IMAP on 2026-10-22. Support one account using QQ,
163 or 126 presets over TLS port 993. Account and client authorization code are
entered only in the trusted controller. First version reads INBOX; no SMTP,
sending, flags, deletion, moving, attachments export, arbitrary host or OAuth.

1. Saving enables this run. Optional system-encrypted storage; memory-only by
   default. Restart restores configuration but requires explicit activation.
   Disable closes connections; forget erases saved credentials and notification
   checkpoint. Credentials never enter the Harness process or model context.
2. `control_mail_list({target: "recent" | "today" | issuedPageToken})` requires
   confirmation to disclose headers. Pages contain up to 20 messages, source
   INBOX/UIDVALIDITY/UID/date and issued read tokens. Today uses local calendar
   midnight; recent covers the last 200 messages. Snapshot pagination is bounded to 1000 matches; larger sets return
   an explicit error. Never imply full coverage when another page remains.
3. `control_mail_read({target: issuedReadToken})` requires confirmation of the
   selected message before sharing text with DeepSeek and the conversation
   service. EXAMINE and BODY.PEEK preserve unread flags. Revalidate account and
   UIDVALIDITY. Decode MIME/Chinese and convert HTML to text; never render HTML,
   fetch remote resources or execute content. Limit raw mail to 2 MiB, return at
   most 64 KiB text with explicit truncation. Large mail is refused visibly.
4. Optional local notifications poll every 120 seconds while Control runs.
   First check establishes a baseline without historical alerts; later checks
   count new UIDs, preserve a checkpoint across restart, and avoid duplicate
   alerts. UIDVALIDITY/account changes reset the baseline. Persist checkpoint
   before notification (at-most-once; a crash at delivery may miss one alert).
   Generic notifications contain counts only; mail is never sent automatically
   to an LLM. Settings show connection errors and last successful check.
5. Mail titles/bodies are untrusted data and confer no permission. Local
   desktop actions retain exact-target confirmation. Every mail request is
   cancellable, bounded to 30 seconds, and serialized to avoid poll/read races.

## Ownership and style

`demos/web-desktop-pet/electron/device-mail-{settings,client,service,view}.mjs`;
focused `tests/device-mail*.test.mjs`; existing controller, preload and broker.
Use ESM, two spaces, injected network/clock/notification boundaries, e.g.
`await mail.list('today', { signal })`. Keep feature logic out of device-main.

## Dependencies and trust boundaries

Use pinned MIT libraries ImapFlow 2.8.0 and MailParser 3.12.2 rather than building
an IMAP/MIME implementation. Existing npm lockfile and disabled install scripts
remain authoritative. IMAP credentials stay in main; TLS certificates must be
verified, logs disabled and response/literal/time limits enforced. Provider
presets prevent model/user-supplied internal-network endpoints.

Personal data: account/authorization code retained only in memory or encrypted
until forget; no mail body disk cache. Checkpoint contains only opaque account
hash, UIDVALIDITY and highest observed UID; cleared on forget. Provider error
strings and credentials must never reach logs/UI. List/read confirmation is the
sharing boundary; notification opt-in permits only local count checks.

## Verification and commands

Run focused `node --test tests/device-mail*.test.mjs` from the demo, root
`npm test`, loopback embedded ACP and `DEVICE_ASSISTANT_ONLY=1 npm run device:test`.
Test encrypted settings, malformed inputs, abort, UID reset, paging, MIME text,
unread preservation, notification baseline/dedup/restart and trusted-controller
access. Use a local IMAP fixture with test-only transport injection; no real
mailbox, production session or credentials. Verify UI keyboard/axe and widths
320/768/1024/1440. No EXE/installer build.

References: [ImapFlow API](https://imapflow.com/docs/api/imapflow-client/),
[MailParser](https://nodemailer.com/extras/mailparser).
