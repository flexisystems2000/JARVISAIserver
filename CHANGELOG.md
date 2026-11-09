# Changelog

## 3.2.0 — Full WhatsApp command tool integration

- Added a 68-entry Command Registry in `agent/commandRegistry.js`, including aliases and subcommands.
- Exposed every catalogued command form as an Agent tool (`whatsapp_*`).
- Routed Agent tool execution through the existing WhatsApp message/command pipeline so existing handlers and their permission checks are reused rather than duplicated.
- Added `command_registry_list` and `command_registry_get` for Agent-side discovery.
- Prevented duplicate AI replies when an existing WhatsApp command handler has already replied.
- Kept configured JARVIS system-admin permissions separate from WhatsApp group-admin status; group-scoped tools rely on live WhatsApp metadata.
- Allowed configured system admins and the owner to use read-only GitHub inspection and connector-verification tools.
- Preserved approval requirements for GitHub write/deploy operations and the existing Piper TTS integration.
- Added registry, permission, approval and Agent dispatch tests.

## 3.1.0

- Existing JARVIS AI WhatsApp agent, command handlers, GitHub tools, Command Inventor, poll quiz, PDF service and Piper TTS functionality.
