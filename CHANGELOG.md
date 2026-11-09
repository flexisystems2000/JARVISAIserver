# Changelog

## 3.3.0 — AI-led discovery, bounded prompts and multi-step execution

- Replaced the planner's all-tools/all-schemas prompt with an AI-led discovery pass using a compact, permission-filtered tool catalog, followed by detailed schemas for only the selected tools.
- Added validated multi-step plans (up to five actions); every step and nested argument is validated before the first side effect, and execution stops when approval is pending or a WhatsApp command has already replied.
- Added one correction attempt for malformed or schema-invalid plans; invalid plans never execute.
- Added a configurable 35,000–40,000 character planner prompt budget, prioritizing the current request and trimming older conversation context.
- Added preflight measurement of serialized AI request bytes, correlation IDs and structured gateway error diagnostics.
- Preserved all 68 WhatsApp command forms, existing dispatch handlers, permission checks, approval gates, group-admin separation, and Piper/TTS behavior.
- Added planner discovery, multi-step, nested-schema, prompt-budget, and gateway diagnostic tests.


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

## 3.2.1
- Hardened AI planner parsing for JSON objects, fenced JSON and JSON embedded in model text.
- Added one safe planner-format repair attempt; no tool runs until the repaired plan validates.
- Propagated AI gateway failures to the Agent instead of disguising them as malformed JSON.
- Added tests for malformed output recovery and gateway/network failures.
