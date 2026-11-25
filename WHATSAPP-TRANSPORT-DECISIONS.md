# WhatsApp transport and rich-message integration status

Updated: 2026-11-25

## Active WhatsApp transport

JARVIS uses one authenticated WhatsApp socket from `@flexisystems/baileys@^0.5.9`, loaded dynamically from the existing CommonJS entry point. The same socket handles ordinary messages, group events, rich replies, group-status publishing and the Hiroosy VoIP adapter. Do not run a second Baileys transport against the same authentication state.

## Group status publishing

- Flexi Baileys exposes `sock.sendGroupStatus(groupJidOrJids, content, options)`.
- Supported message content uses the library's standard text and media payloads.
- The helper sends each group target separately, wraps the payload as `groupStatusMessageV2`, and adds the group-status metadata node.
- JARVIS exposes the admin-only `!groupstatus [text]` command for publishing text directly to the current group.
- This is separate from personal status publishing and from status-mention notifications. Existing status-mention routing remains unchanged.
- A live WhatsApp group post has not yet been verified after this release; test with a controlled group before relying on it.

## Other integrated features

- `rich-renderer.js` uses Flexi Baileys public rich-message helpers for the existing rich response path.
- `quizEngine.js` and `channelQuizScheduler.js` use the same authenticated socket for the existing WhatsApp newsletter quiz features.
- The Hiroosy VoIP engine is vendored inside Flexi Baileys and is accessed through the existing socket. Live call validation remains separate from ordinary message delivery.

## Validation boundaries

Successful npm publication and successful Render startup confirm package availability and application startup, not live WhatsApp group-status delivery. Validate text, image and video group-status posts in a private test group, then confirm that ordinary group messages, status mentions, group moderation, reconnects and calls still behave as expected.
