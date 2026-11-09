# Changelog

## 3.3.0 — 2026-11-09
- Replaced the single-shot planner with bounded AI-led tool discovery and detailed schema retrieval for selected tools.
- Added validated multi-step orchestration (up to five ordered tool calls), low-confidence refusal, approval-aware stopping and a 35,000–40,000 character prompt budget (default 38,000).
- Connected the CodingAgent to the actual WhatsApp Agent registry and GitHub static website publisher. Natural-language website requests now generate files internally instead of requiring the planner to return a large source-code array.
- Aligned website validation with GitHub's 50 KB per-file and 450 KB total limits; kept root `index.html`, safe path and likely-secret checks.
- Added authenticated-user owner fallback for GitHub publishing when `GITHUB_OWNER` and the request owner are omitted.
- Added correlation IDs and structured AI gateway failure diagnostics in JARVIS.
- Preserved the 68-command catalog, existing handlers, role boundaries, group-admin approval scope, Piper document/TTS integrations and existing features.

## 3.2.1
- Previous stable source baseline; see repository history for earlier changes.
