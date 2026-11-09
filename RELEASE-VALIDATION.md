# Release validation — JARVIS 3.3.0

Validated in the source tree on Node.js 22:
- `npm run check` — passed (syntax checks for the application, agents and tests).
- `npm test` — 35 passed, 0 failed.
- Command catalog tests verify all 68 WhatsApp command forms remain registered and callable.
- Website tests verify approval gating, AI-generated file parsing, path/secret/file-size validation, and that CodingAgent calls the actual GitHub static publisher method.
- Planner tests verify dynamic tool discovery, detailed-schema selection, ordered multi-step execution and bounded prompts.

The GitHub API and live GitHub Pages publishing were not exercised against a real account during this local test run. Deployment still requires a correctly scoped `GITHUB_TOKEN`, repository permissions and Pages support.
