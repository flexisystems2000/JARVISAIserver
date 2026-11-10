# JARVIS 3.3.1 — Upgrade notes

## Command visibility
- Exactly 57 command forms are exposed as Agent tools.
- `!define` and `!dictionary` are removed from the Agent registry and `!menu`.
- `!add`, `!kick`, `!remove all`, `!ban`, `!unban`, `!promote`, `!mute`, `!unmute` and `!reset` remain in the WhatsApp command menu and existing handlers, but are not Agent tools.

## File creation
`!createfile` supports PDF, DOCX, XLSX, PPTX, CSV, TXT, Markdown, HTML and JSON. It infers the requested format, accepts a filename/title, creates a real file through the authenticated Python document service and sends it as a WhatsApp document. PDF remains the default. Install the updated `python_services/requirements.txt` in the document service before deployment.

## Memory and AI reliability
MongoDB conversation turns now support an interaction ID to avoid duplicate user/assistant records when a WhatsApp event is processed more than once. The existing per-chat/per-user boundary and 200-record cap remain. Agent dispatch results and useful Agent failures are saved. Planner prompts are smaller, malformed structured output receives one correction attempt, and HTTP 413 receives at most one compacted retry.

## Permissions and Piper
Approval remains available to the bot owner, system administrators and authorized administrators of the requesting WhatsApp group. Ordinary group members and administrators of unrelated groups are denied. Piper TTS source, voice engine and existing endpoints were not replaced or restructured.

## Local validation
- Node.js automated tests: 64 passed, 0 failed.
- Node.js syntax checks: passed.
- Python document/PDF tests: 9 passed, 0 failed.
- Live WhatsApp, AI provider, MongoDB and Piper playback checks require deployment credentials and a staging environment.

## Frontend Firebase configuration
The Firebase browser configuration, including its public Web API key, remains embedded in the frontend as in the original project. No `FIREBASE_WEB_API_KEY` environment variable is required. Restrict the key to required APIs and enforce access through Firebase Authentication and security rules.
