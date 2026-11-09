# JARVIS 3.3.0 integration and deployment notes

## Release contents
This release keeps the existing JARVIS WhatsApp application and adds bounded AI-led tool discovery, multi-step orchestration and a connected static website coding workflow. AI Link 1.5.0 supplies request budgets and structured 413 diagnostics.

## Deploy AI Link first
1. Back up the current AI Link service and environment variables.
2. Replace the service source with the contents of `Flexieduconsult-AI-link-1.5.0.zip`.
3. Run `npm install`, `npm run check`, and `npm test`.
4. Deploy the service with the existing `JARVIS_API_KEY`, Gemini keys, `GEMINI_MODEL` and `PUTER_AUTH_TOKEN` values unchanged.
5. Check `/test`; then confirm `/ai` still requires the shared key. The gateway accepts at most 50,000 prompt characters and 12 MiB serialized JSON by default.

## Deploy JARVIS
1. Back up the current Render service, WhatsApp auth/session data, MongoDB and environment variables.
2. Replace the JARVIS source with `JARVISAIserver-3.3.0.zip`.
3. Run `npm install`, `npm run check`, and `npm test` on Node.js 20+.
4. Deploy with existing environment variables. `AI_API_URL` must point to the deployed AI Link; `AI_API_KEY` must exactly match AI Link's `JARVIS_API_KEY`.
5. Keep `OWNER_NUMBER`, `ADMIN_NUMBERS`, `MONGO_URI`, Piper settings, ALOC settings and all existing provider credentials unchanged.
6. For website creation, set `GITHUB_TOKEN` to a least-privilege token that can create public repositories (or administer the selected repository), write repository contents and enable GitHub Pages. Optionally set `GITHUB_OWNER` and `GITHUB_ALLOWED_REPOS`.
7. Confirm JARVIS reconnects to WhatsApp, run `!approvals`, and verify the normal command menu and existing commands in a staging chat.

## Website creation flow
A configured JARVIS admin/owner can ask for a website in natural language, for example: “Create a responsive website for Flexi Digital Academy with Home, Courses, About and Contact sections. Publish it as flexi-academy-site.” JARVIS requests approval. After approval it generates a static site, validates file paths and likely secrets, publishes the files, enables GitHub Pages and returns the configured Pages URL. First publication may take several minutes.

This workflow is for static HTML/CSS/JavaScript sites. It is not a Next.js/React build service and does not provision backend servers, databases or API hosting. Do not describe a configured Pages URL as live-verified until it has been checked separately.

## Rollback
If either service fails its health check, restore its previous source ZIP and corresponding environment configuration. Do not delete or replace WhatsApp auth/session data or persistent `data/` approval/audit files during rollback.
