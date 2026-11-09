# JARVIS AI WhatsApp Bot — 3.1.0
**Flexi edTech Digital Academy**

JARVIS is the existing WhatsApp assistant extended with a structured AI tool registry, authorization checks, a persistent, group-admin-aware approval queue, a sandboxed development shell, GitHub repository tools, and an ALOC-based native poll quiz. Existing moderation, payments, reminders, dashboard and rich-response modules are retained.

## Requirements and installation

- Node.js 20 or later
- MongoDB (if using the existing persistent features)
- Gemini API credentials used by the existing AI configuration
- `ALOC_TOKEN` for ALOC questions
- WhatsApp account for the Baileys session

```bash
npm install
cp .env.example .env
npm run check
npm test
npm start
```

Do not commit `.env`, `auth_info/`, audit logs, approval data, or the sandbox workspace.

## AI gateway and Python document service

JARVIS calls the Flexieduconsult AI Link through `AI_API_URL` and authenticates every `/ai` and `/image` request with `AI_API_KEY`. Set this value to exactly the same secret as `JARVIS_API_KEY` on the AI Link deployment. The agent planner requests JSON-mode model output; the tool registry still validates tool names, arguments, permissions and approvals before execution.

PDF creation and PDF text extraction are performed by the Python/ReportLab service, not by the AI Link. The JARVIS package includes `python_services/piper_pdf_router.py`; mount its FastAPI router into the existing Piper app as described in `python_services/README.md`. The routes use the existing `PIPER_API_KEY` and expose `/pdf/generate` and `/pdf/extract`. Piper remains responsible for TTS/voice and its existing media services. If the router is hosted separately, point `PIPER_DOCUMENT_API_URL` at that service's base URL.

The AI Link no longer provides PDF, OCR or quiz endpoints. JARVIS owns ALOC quiz retrieval, WhatsApp poll voting, the 30-second timer, answer explanation and next-question progression.

## ALOC WhatsApp poll quiz

`!quiz <subject>` starts a native WhatsApp poll quiz in the current group. Quiz delivery is poll-only.

- Subjects are resolved using the existing ALOC subject map.
- Each poll has four A-D options and a 30-second voting window.
- After voting closes, JARVIS displays aggregate vote counts (not student score tables), the correct option, and an AI-generated explanation where the Gemini service is available.
- JARVIS fetches and posts the next question automatically.
- `!stopquiz` lets a group administrator or the bot owner stop the active quiz.
- Individual text-answer scoring and persistent student score storage are disabled.

Poll-vote decryption depends on the installed Baileys fork emitting decrypted `pollUpdates` in `messages.update` and exporting `getAggregateVotesInPollMessage`. If the helper is unavailable, the quiz still closes, reveals the correct answer and advances, but reports that aggregate counts could not be decrypted. Test with a real staging WhatsApp group before production use.

## AI tools, commands and approvals

The AI planner may call only registered tools. The registry validates declared arguments, applies per-actor rate limits, checks roles and writes success/failure audit events.

Sensitive registered tools are queued rather than executed immediately. The configured bot owner and configured system admins can manage approvals globally. A current WhatsApp administrator can approve or reject requests originating in that same WhatsApp group:

- `!approvals` — list pending requests
- `!approve <ID>` — approve and execute one pending action
- `!reject <ID>` — reject it without execution

Requests expire after 10 minutes by default. Approval records are stored under `data/approvals/` with restrictive file permissions. Approval is single-use. Approval-gated examples include changing a WhatsApp group name, GitHub file writes/deletions, and saving a generated command. GitHub writes additionally require the token to have repository write permission; file deletion requires repository administrator permission. These checks do not bypass provider-side permissions.

The Command Inventor supports `!command list` and `!command create name | description | template`. It only persists safe `echo` and `template` commands; it does not generate arbitrary JavaScript or shell scripts. Ordinary members can propose a command, but a JARVIS owner/system admin or an administrator of the requesting WhatsApp group must approve it before persistence. Saved commands are stored under `data/commands/` and can be invoked as `!command_name` by authorised admins.

## GitHub Pages website creation

The Agent exposes `website_create_and_deploy` for static HTML/CSS/JavaScript websites. JARVIS creates or updates the requested repository, publishes up to 30 text files (including a root `index.html`), enables GitHub Pages, and returns the Pages URL. The action requires an explicit approval and the configured GitHub token must have the required repository creation/admin and Pages permissions. The returned URL is the configured publication URL; the first deployment can take several minutes to become publicly reachable, so JARVIS does not claim it is live-verified until an actual HTTP check succeeds.

## Platform authentication and GitHub

`GITHUB_TOKEN` is verified against GitHub's authenticated-user endpoint. JARVIS can list repositories, inspect repository trees, read files, search code, inspect issues/PRs, verify repository-admin access, and run a read-only static security triage. `GITHUB_ALLOWED_REPOS` can optionally restrict repository access to a comma-separated list such as `owner/repo,another-owner/project`.

GitHub static security triage checks eligible text files for common secret patterns and tracked live `.env` files. It redacts detected values. It is not a complete SAST/DAST system, does not exploit systems, and does not prove that a repository is secure.

Additional platform adapters can verify a provider identity through a configured HTTPS endpoint using `JARVIS_PLATFORM_ADAPTERS`. This is an identity-verification extension point, **not** a completed OAuth integration or a universal platform action connector. Each provider still needs its own official API adapter, resource-level permission checks and action implementation before JARVIS can manage that platform.

Never send passwords, private keys, session cookies, recovery codes or OTPs through WhatsApp. Use provider-issued least-privilege API tokens configured in Render environment variables. Verifying an account identity does not automatically establish administrator access to every resource; resource permissions must be checked separately.

## White-hat security scope

Security checks are intended only for repositories and systems the operator owns or is explicitly authorized to assess. The included GitHub review is read-only. No exploitation, credential validation, stealth, persistence, destructive scanning or out-of-scope target discovery is implemented. Changes to repositories require an approval request and provider permission checks.

## Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP service port (default 3000) |
| `OWNER_NUMBER` | Bot owner number in international digits, no `+` |
| `ADMIN_NUMBERS` | Optional comma-separated JARVIS system-admin numbers; WhatsApp group admins are detected from live group metadata |
| `MONGO_URI` | MongoDB connection string |
| `AI_API_URL` | Base URL of the authenticated Flexieduconsult AI Link |
| `AI_API_KEY` | Shared secret matching `JARVIS_API_KEY` on the AI Link |
| `AI_TIMEOUT_MS` | AI gateway request timeout in milliseconds |
| `PIPER_API_KEY` | Shared secret for Piper TTS and the Python PDF routes |
| `PIPER_DOCUMENT_API_URL` | Base URL exposing `/pdf/generate` and `/pdf/extract` |
| `PIPER_DOCUMENT_TIMEOUT_MS` | Python document API timeout in milliseconds |
| `ALOC_TOKEN` | ALOC API access token |
| `GITHUB_TOKEN` | Least-privilege GitHub token |
| `GITHUB_OWNER` | Optional default GitHub owner/org |
| `GITHUB_ALLOWED_REPOS` | Optional comma-separated repository allowlist |
| `JARVIS_PLATFORM_ADAPTERS` | Optional JSON array of provider HTTPS identity adapters |
| `DOCKER_BIN` | Optional Docker executable name/path for sandbox execution |
| `JARVIS_SANDBOX_WORKSPACE` | Host directory mounted into `/workspace` in the isolated container |

The existing project may also require Firebase and other settings used by its pre-existing features. Gemini credentials belong only in the Flexieduconsult AI Link environment; do not put Gemini provider keys in JARVIS. Keep all secrets in Render environment settings, not in this ZIP.

## Render deployment

1. Push the project to a private/authorized Git repository.
2. Create or update the Render service using Node 20+.
3. Set build command to `npm install` and start command to `npm start`.
4. Add the required environment variables in Render. Do not upload `.env` or WhatsApp session files to source control.
5. Deploy, scan the pairing QR using the WhatsApp account intended for JARVIS, and check the service logs.
6. Test `!quiz Mathematics`, voting, 30-second close, explanation, next-question progression, `!stopquiz`, and approval request/reject/approve in a private staging group.
7. Test GitHub identity and repository permissions with a token limited to the repositories JARVIS should access.
8. Deploy the authenticated AI Link with the matching `JARVIS_API_KEY`; set `AI_API_URL` and `AI_API_KEY` in JARVIS.
9. Mount `python_services/piper_pdf_router.py` into the existing Piper FastAPI app, deploy it with `PIPER_API_KEY`, then test `generate pdf ...` and PDF upload analysis in a private chat.

## Verification and limitations

The included automated suite covers tool validation, role checks, approval lifecycle, command-template validation, shell-command rejection, platform identity adapter validation, and the poll quiz flow using mocked ALOC/WhatsApp responses. It does not constitute a live WhatsApp, ALOC, Gemini, GitHub, MongoDB, Docker or Render integration test. Those require the operator's own credentials and staging environment.

The group Watchdog remains enabled for configured blocked terms and links. It now uses whole-word matching to avoid substring false positives, and current WhatsApp group admins are excluded from moderation. Group admins are verified from live WhatsApp group metadata rather than relying only on environment variables. Universal OAuth and platform management for every service are not claimed as complete; each platform must be integrated and tested individually.

See [`INTEGRATION-DEPLOYMENT.md`](INTEGRATION-DEPLOYMENT.md) for the end-to-end AI Link, Piper and PDF setup.


## AI-first planner and external services

Natural-language requests are interpreted by the AI planner and mapped to registered tools. The former local keyword/regex natural-language router has been removed. Tool plans require a confidence value of at least 0.75 and still pass argument, role, rate-limit and approval checks. Deterministic explicit commands remain available. See `INTEGRATION-DEPLOYMENT.md` for the paired AI Link and Piper/PDF deployment steps.


## Agent Command Registry (3.2.0)

JARVIS exposes 68 WhatsApp command forms (including aliases and subcommands) as individual `whatsapp_*` Agent tools. The catalog lives in `agent/commandRegistry.js`; the Agent can inspect it through `command_registry_list` and `command_registry_get`.

Agent command tools dispatch through the existing WhatsApp message handler. This deliberately reuses existing command implementations and their group/owner permission checks rather than creating parallel implementations. Command responses are sent by the original handler, so the Agent suppresses a duplicate conversational reply after dispatch.

The 68 entries represent command forms, not 68 independent business capabilities: aliases such as `!dictionary`/`!define` and `!getgroupids`/`!groupids` reuse the same underlying handler. `!create document` and `!generate pdf` route to the existing PDF/document creation handler.

Configured JARVIS system admins and the owner can use read-only GitHub inspection tools. System-admin privileges are kept separate from WhatsApp group-admin status: group actions verify live WhatsApp metadata, and group admins do not gain global GitHub or system-admin privileges. GitHub write/deploy operations remain approval-gated. Existing Piper TTS settings and endpoints are unchanged.

Run `npm run check` and `npm test` before deployment. Live WhatsApp, AI endpoint, GitHub API and Render integration still need to be tested in the deployed environment.

### AI planner troubleshooting (3.2.1)
The planner accepts valid JSON objects, fenced JSON, and a JSON object embedded in a model response. If the first response is malformed, it requests one corrected JSON response; it never executes a tool until the plan validates. AI gateway HTTP/network errors are surfaced separately, so check the JARVIS logs for `[AI GATEWAY] Request failed` and verify `AI_API_URL`, `AI_API_KEY`, and the AI Link JSON-mode response if a planner request still fails.
