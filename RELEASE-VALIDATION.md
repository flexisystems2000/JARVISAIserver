# Release validation — JARVIS 3.3.1

Validated in the source tree on Node.js 22 and the available Python runtime:

- `npm run check` — passed (application, Agent modules and test syntax).
- `npm test` — 64 passed, 0 failed.
- `python -m unittest discover -s python_services -p 'test_*.py' -v` — 9 passed, 0 failed.
- Command tests verify exactly 57 Agent-visible command forms, the two removed dictionary commands, the nine WhatsApp-only group-management commands, menu coverage and callable tool registration.
- Planner tests cover fenced/embedded JSON, malformed plans, schema validation, discovery, one repair attempt, duplicate execution prevention, bounded prompts and HTTP 413 compaction.
- Conversation-memory tests cover chat/user isolation, chronological context, paired user/assistant records and idempotency by WhatsApp interaction ID.
- Approval tests cover bot-owner, system-admin and same-group WhatsApp administrator approval, cross-group rejection and ordinary-member denial.
- File-generation tests create and validate PDF, DOCX, XLSX, PPTX, CSV, TXT, Markdown, HTML and JSON; they also check filename validation, HTML sanitization and spreadsheet formula escaping.
- PDF regression tests cover the legacy generation and extraction routes.
- Existing Piper router and PDF service source were preserved; the Python requirements only gained the document-generation libraries required by DOCX/XLSX/PPTX/HTML support.

Live WhatsApp delivery, live AI-provider requests, MongoDB connectivity, and deployment-provider integration cannot be proven by this local test run. Those still require the deployment environment and its credentials.
