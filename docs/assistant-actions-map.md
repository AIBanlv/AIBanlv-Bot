# Assistant Desktop Actions

Scope approved on 2026-10-22: continue application launching and reversible
desktop organization through verification, then add read-only IMAP email,
incoming notifications, reading and summaries. User selected QQ/163-style IMAP.
Vision is not required for these actions.

| Module | Responsibility | Depends on |
| --- | --- | --- |
| app-launch | Discover this user's installed apps and request launch after approval | Windows |
| desktop-organize | Preview, organize and restore this user's desktop files | Windows |
| assistant-actions | Expose these operations through the existing authenticated broker | Both modules |
| mail-read | Encrypted account setup, read-only INBOX listing/reading | IMAP provider |
| mail-notify | Local incoming-mail notifications while Control runs | mail-read |

Build order: app-launch, desktop-organize, then assistant-actions and end-to-end
verification. Contracts: `assistant-app-launch-spec.md` and
`assistant-desktop-organize-spec.md`. Local agent planning notes are in the
ignored `tasks/` directory; the specifications above define the shipped contract.

Never record the developer's application paths in the product. All app entries
and the actual desktop location are discovered on the current user's machine.
Keep the existing curated Harness composition; no arbitrary model-supplied shell
commands, general filesystem writes, third-party plugin installation or email sending.
Email contract: `assistant-mail-spec.md`; build mail-read before mail-notify.
