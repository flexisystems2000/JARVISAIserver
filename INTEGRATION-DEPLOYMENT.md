# JARVIS 3.3.1 integration and deployment notes

## Release contents
This release retains the existing JARVIS WhatsApp application and adds a 57-command Agent catalog, safer bounded AI planning, idempotent MongoDB conversation-turn persistence, and general-purpose nine-format file generation. The nine group-management commands remain WhatsApp-only. The existing Piper TTS integration and legacy PDF routes are preserved.

## Deploy JARVIS
1. Back up the current JARVIS service, WhatsApp auth/session data, MongoDB and environment variables.
2. Replace the JARVIS source with the complete `JARVISAIserver-3.3.1.zip` project contents.
3. Use Node.js 20 or newer; run `npm install`, `npm run check`, and `npm test`.
4. Deploy with the existing environment variables. `AI_API_URL` must point to the deployed AI Link; `AI_API_KEY` must match the AI Link's `JARVIS_API_KEY`.
5. Keep `OWNER_NUMBER`, `ADMIN_NUMBERS`, `MONGO_URI`, Piper settings, ALOC settings and all existing provider credentials unchanged. Firebase browser configuration remains embedded in the frontend as it was in the original project; no `FIREBASE_WEB_API_KEY` environment variable is required.
6. Confirm JARVIS reconnects to WhatsApp, then test the command menu, Agent discovery and restricted approvals in a staging group.

Firebase Web API keys are intended to be present in browser configuration. Restrict the key to the Firebase-related APIs this app needs, and rely on Firebase Authentication plus Firestore/Storage security rules for access control; the key itself must not be treated as authorization.

## Nine-format file generation
`!createfile` accepts PDF, DOCX, XLSX, PPTX, CSV, TXT, Markdown, HTML and JSON requests. It infers the format from the user's wording or filename, defaults to PDF when no format is supplied, and sends the generated file as a WhatsApp document.

The configured `PIPER_DOCUMENT_API_URL` service must expose the authenticated routes `/pdf/generate`, `/pdf/generate-file` and `/pdf/extract`. Install the updated `python_services/requirements.txt` in that document service (or merge the requirements into the existing Piper service environment) before deploying. Keep `PIPER_API_KEY` identical on JARVIS and the document service. If the existing Piper deployment hosts the router, retain its current app and mount the existing `piper_pdf_router` as documented in `python_services/README.md`; do not replace the Piper speech engine or voice endpoints.

The legacy PDF generation and extraction routes remain supported. HTML is sanitized, filenames are reduced to safe basenames, and spreadsheet formula-like text is escaped before writing CSV/XLSX cells.

## AI gateway
The Agent prompt budget defaults to 30,000 characters and is clamped to 24,000–32,000 characters. If the gateway rejects a long request with HTTP 413, JARVIS makes one compacted retry. Planner structured output receives one repair attempt; invalid plans are not executed. The AI gateway's own request limits remain authoritative.

## Approvals and permissions
The bot owner and configured system administrators can approve globally. A current WhatsApp group administrator can approve a request originating in that same group. An ordinary group member cannot approve restricted operations, and group-admin status does not grant global JARVIS system-admin privileges.

## Live deployment checks
Local automated tests do not prove live WhatsApp delivery, AI-provider availability, MongoDB connectivity, Piper voice playback, or provider-side deployment permissions. Verify those in the target deployment using its existing credentials and a staging chat.

## Rollback
If a service fails its health check, restore its previous source archive and corresponding environment configuration. Do not delete or replace WhatsApp auth/session data or persistent `data/` approval/audit files during rollback.
