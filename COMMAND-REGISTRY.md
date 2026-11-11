# JARVIS AI command and Agent tool registry

This document describes the current menu and the tool families exposed to the existing AI Agent. The authoritative WhatsApp command handlers remain in `index.js`; the AI Agent tool definitions are registered in the same file. The registry is not a separate agent and does not replace existing handlers.

## Retired commands
- `!define`
- `!dictionary`
- `!translate`

These commands and their aliases are not registered or displayed in `!menu`.

## AI Agent tool families
- AI media: image generation and multi-format file creation.
- Education: department timetables and subject quiz start/stop.
- Reminders and voice: create/list/cancel reminders and enable/disable TTS.
- Web and media: website inspection and YouTube search.
- Bot/group information: status, group information, group admins, online activity, chat ID and owner-only group listing.
- Group administration: rename, mute/unmute, quiet mode, add/remove/promote/ban/unban members and reset warnings. Group membership changes require approval and a fresh group-admin check.
- GitHub: list repositories, inspect trees, read files, search code, review issues/PRs and protected writes.
- Website deployment: create a Vercel deployment or import an authorised GitHub repository into a Vercel deployment. Production deployment requires approval.
- Flexi/account: learner profile name and monthly/weekly payment flow.

## Commands intentionally not exposed as Agent tools
- `!vv` retrieves view-once media and is not exposed to the AI Agent.
- `!remove all` is exposed only through the separate approval-gated `group_remove_all_non_admins` tool, with a fresh group-admin check.

## Permissions
- Read-only GitHub operations are available to the bot owner, configured system administrators and current WhatsApp group administrators.
- Group changes require a current group admin (or bot owner where the existing handler permits it); high-impact member changes also require approval.
- GitHub writes/deletes and Vercel production deployment remain approval-gated.
