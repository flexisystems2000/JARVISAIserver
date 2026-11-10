# Changelog

## 3.3.1 — 2026-11-10
- Reduced the Agent-visible command catalog to exactly 57; removed `!define` and `!dictionary` from the menu and Agent registry.
- Kept all nine group-management commands available through WhatsApp handlers while excluding them from Agent tool discovery.
- Added general-purpose AI file creation for PDF, DOCX, XLSX, PPTX, CSV, TXT, Markdown, HTML and JSON with authenticated Python rendering and WhatsApp document delivery.
- Preserved the legacy PDF generation and extraction routes and the existing Piper router/service integration.
- Added idempotent MongoDB turn persistence keyed by the source WhatsApp message ID, preserving chat/user isolation and the 200-record history cap.
- Rejected duplicate tool registrations and duplicate identical steps in a single Agent plan.
- Reduced the Agent prompt budget and added one bounded HTTP 413 compaction retry.
- Added command, planner, conversation-memory, file-generation, security and PDF regression tests.


## 3.3.0 — 2026-11-09
- Replaced the single-shot planner with bounded AI-led tool discovery and detailed schema retrieval for selected tools.
- Added validated multi-step orchestration (up to five ordered tool calls), low-confidence refusal, approval-aware stopping and a bounded prompt budget.
- Connected the CodingAgent to the actual WhatsApp Agent registry and GitHub static website publisher. Natural-language website requests now generate files internally instead of requiring the planner to return a large source-code array.
- Aligned website validation with GitHub's 50 KB per-file and 450 KB total limits; kept root `index.html`, safe path and likely-secret checks.
- Added authenticated-user owner fallback for GitHub publishing when `GITHUB_OWNER` and the request owner are omitted.
- Added correlation IDs and structured AI gateway failure diagnostics in JARVIS.
- Preserved the command handlers and role boundaries, existing handlers, role boundaries, group-admin approval scope, Piper document/TTS integrations and existing features.

## 3.2.1
- Previous stable source baseline; see repository history for earlier changes.
