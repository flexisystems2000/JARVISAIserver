# JARVIS AI WhatsApp Bot — 3.4.0
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

File creation is performed by the authenticated Python service, not by the AI Link. The JARVIS package includes `python_services/piper_pdf_router.py`; mount both its PDF and general-file routers into the existing Piper FastAPI app as described in `python_services/README.md`. The routes use `PIPER_API_KEY` and expose `/pdf/generate`, `/pdf/extract` and `/files/generate`. The general file route supports PDF, DOCX, XLSX, PPTX, CSV, TXT, Markdown, HTML, JSON, XML, YAML, CSS, JavaScript, Python, PHP, Java, C++, SQL, SVG, RTF, TypeScript/TSX/JSX, C/C++, C#, Go, Rust, Ruby, shell/PowerShell, TOML, INI, configuration, LaTeX, MDX, JSONL and ZIP. Generated content is validated and malformed structured output receives one repair attempt before delivery. The project sandbox uses a task-specific writable workspace mounted into a disposable, network-disabled container with dropped Linux capabilities, resource limits and automatic cleanup. If Docker is unavailable, JARVIS marks the project unverified rather than claiming it passed. Piper remains responsible for TTS/voice and its existing media services. If hosted separately, point `PIPER_DOCUMENT_API_URL` at that service's base URL.

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

## ALOC WhatsApp Channel native quiz

`!channelquiz <subject>` publishes native WhatsApp quiz polls to the configured Flexi Educational Consult Channel. `!channelquiz off` stops the automatic sequence. These commands are accepted only when sent as a post in the configured Channel; WhatsApp controls who is allowed to publish Channel updates.

- Uses the same `ALOC_TOKEN`, ALOC API endpoint, subject map, aliases and question retrieval as group quizzes.
- Publishes a native newsletter quiz (`pollType: 1`) with four A-D options and ALOC's correct option supplied as native quiz metadata.
- Publishes the next question every 30 seconds until `!channelquiz off` is used.
- Does not publish the correct answer, ALOC solution, vote totals, AI explanation or student scores as a follow-up Channel message.
- The native quiz message must contain the correct option metadata for WhatsApp to treat it as a quiz. WhatsApp controls any correctness feedback shown inside its own client after a follower votes; JARVIS does not send a separate answer reveal.

Set `FLEXI_CHANNEL_JID` to override the default Flexi Channel JID. The default remains the existing Flexi Educational Consult newsletter ID.

## AI tools, commands and approvals

The AI planner may call only registered tools. The registry validates declared arguments, applies per-actor rate limits, checks roles and writes success/failure audit events.

Sensitive registered tools are queued rather than executed immediately. The configured bot owner and configured system admins can manage approvals globally. A current WhatsApp administrator can approve or reject requests originating in that same WhatsApp group:

- `!approvals` — list pending requests
- `!approve <ID>` — approve and execute one pending action
- `!reject <ID>` — reject it without execution

Requests expire after 10 minutes by default. Approval records are stored under `data/approvals/` with restrictive file permissions. Approval is single-use. Approval-gated examples include changing a WhatsApp group name, GitHub file writes/deletions, and saving a generated command. GitHub writes additionally require the token to have repository write permission; file deletion requires repository administrator permission. These checks do not bypass provider-side permissions.

The Command Inventor supports `!command list` and `!command create name | description | template`. It only persists safe `echo` and `template` commands; it does not generate arbitrary JavaScript or shell scripts. Ordinary members can propose a command, but a JARVIS owner/system admin or an administrator of the requesting WhatsApp group must approve it before persistence. Saved commands are stored under `data/commands/` and can be invoked as `!command_name` by authorised admins.

## Vercel website deployment

The Agent exposes `coding_project_create` to generate multi-file projects, check JavaScript/Python syntax in disposable Docker containers when Docker is available, and deliver the project as a ZIP archive. `website_create_and_deploy` generates a site from a natural-language specification or accepts supplied static files; `github_repository_deploy_to_vercel` imports an authorised GitHub repository's files into a Vercel deployment. Both are approval-gated and return a `.vercel.app` URL only after Vercel reports the deployment READY and the public URL responds successfully. Direct file deployment supports up to 100 files, 1 MB per file and 8 MB total. It does not run framework dependency installation/build steps; framework projects should use a linked Vercel Git integration or Vercel CLI workflow. Configure `VERCEL_TOKEN` and optional `VERCEL_TEAM_ID` in protected hosting environment variables.

## Engineering integrations

The WhatsApp agent can now use shared group-discussion context when answering a tagged request. Ordinary text messages from all participants are stored in a group-scoped timeline (bounded to the latest 1,500 messages per group); quoted-message IDs are resolved against that timeline. Private user/assistant memory remains separate and is no longer erased by the 10-minute activity timeout.

Engineering tools include multi-file project generation and GitHub repository archive downloads (public repositories for regular users; private repositories restricted to administrators).

JARVIS now has a user-scoped OAuth connection foundation for **GitHub, Supabase, Google/Firebase, Vercel, GitLab, Netlify, Discord, Notion, Dropbox, Figma, Linear, Asana, and Atlassian**. Each connection is associated with the initiating WhatsApp sender, uses one-time expiring OAuth state, stores tokens encrypted with AES-256-GCM, and exposes a native WhatsApp `Connect {Platform}` URL button. Provider OAuth client credentials are configured by the operator in Render; users never send secrets in chat.

This is an extensible integration foundation, not a claim that every provider's read/write API adapter is already complete. Each platform still needs its own resource-aware read/write tools, scope checks, audit events, token revocation handling, and approval gates for consequential changes. Supabase data access must respect the user's database/RLS identity; Firebase must use Google OAuth/IAM grants rather than silently using the bot's Admin identity. Platforms that use API tokens or provider-specific auth instead of OAuth (for example Cloudflare, Render, Railway, AWS, and payment/email APIs) need a separate secure credential-connection flow and must not be presented as OAuth-connected until implemented.

## User-owned API-token connections

In a private JARVIS DM, a user can connect a supported API-token platform with:

```text
!connect-token <platform> <API_TOKEN>
```

The current token-validation registry includes Cloudflare, Render, Railway, DigitalOcean, Stripe, Resend and OpenAI. JARVIS handles this command before the AI planner, attempts to delete the incoming WhatsApp message, refuses to save if deletion fails, validates the token against the provider API, then encrypts it with AES-256-GCM and stores it under the sender's WhatsApp identity. The token is never passed to the AI model or included in ordinary application logs. The same sender can use `!token-connections` to list saved connections and `!disconnect-token <platform>` to remove one.

Tokens are accepted only in private DMs; group submissions are deleted and rejected before group-history persistence. Deletion cannot guarantee removal from WhatsApp notifications, backups, linked devices or copies made before deletion. Users should create dedicated, least-privilege tokens, avoid master/root credentials, and revoke any token that may have been exposed. API-token validation confirms the configured verification endpoint accepts the token; it does not prove that every future action or resource scope is authorised. A token adapter still needs explicit, resource-scoped read/write tools before JARVIS can operate that platform.

## Platform authentication and GitHub

`GITHUB_TOKEN` is verified against GitHub's authenticated-user endpoint. JARVIS can list repositories, inspect repository trees, read files, search code, inspect issues/PRs, verify repository-admin access, and run a read-only static security triage. `GITHUB_ALLOWED_REPOS` can optionally restrict repository access to a comma-separated list such as `owner/repo,another-owner/project`.

GitHub static security triage checks eligible text files for common secret patterns and tracked live `.env` files. It redacts detected values. It is not a complete SAST/DAST system, does not exploit systems, and does not prove that a repository is secure.

The OAuth registry is deliberately extensible. The current providers above are the connection/identity layer; they do not yet mean every provider has a complete read/write action adapter. Each platform still needs resource-aware tools, scope checks, audit events, revocation handling and approval gates before JARVIS can make changes there.

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
| `AI_API_KEY` | Existing shared secret used by JARVIS to authenticate with the Flexi Educational Consult AI Link, including live voice calls |
| `AI_VOICE_URL` | Optional full WebSocket URL for the AI Link voice gateway; defaults to `wss://flexieduconsult-ai-link-wqnb.onrender.com/voice` |
| `PIPER_API_KEY` | Shared secret for Piper TTS and the Python document/file routes |
| `PIPER_DOCUMENT_API_URL` | Base URL exposing `/pdf/*` and `/files/generate` |
| `PIPER_DOCUMENT_TIMEOUT_MS` | Python document API timeout in milliseconds |
| `ALOC_TOKEN` | ALOC API access token used by group and Channel quizzes |
| `FLEXI_CHANNEL_JID` | Optional WhatsApp Channel JID; defaults to the existing Flexi Channel |
| `PLATFORM_OAUTH_BASE_URL` | Public HTTPS JARVIS base URL used for provider callbacks |\n| `PLATFORM_TOKEN_ENCRYPTION_KEY` | 32-byte base64 or 64-character hex key for encrypting user OAuth tokens |\n| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | OAuth app credentials for user-owned GitHub connections |\n| `SUPABASE_OAUTH_CLIENT_ID` / `SUPABASE_OAUTH_CLIENT_SECRET` | OAuth app credentials for user-owned Supabase connections |\n| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth app credentials for Google/Firebase connections |\n| `VERCEL_OAUTH_CLIENT_ID` / `VERCEL_OAUTH_CLIENT_SECRET` | OAuth app credentials for user-owned Vercel connections |\n| `GITLAB_OAUTH_CLIENT_ID` / `GITLAB_OAUTH_CLIENT_SECRET` | GitLab OAuth app credentials |\n| `NETLIFY_OAUTH_CLIENT_ID` / `NETLIFY_OAUTH_CLIENT_SECRET` | Netlify OAuth app credentials |\n| `DISCORD_OAUTH_CLIENT_ID` / `DISCORD_OAUTH_CLIENT_SECRET` | Discord OAuth app credentials |\n| `NOTION_OAUTH_CLIENT_ID` / `NOTION_OAUTH_CLIENT_SECRET` | Notion OAuth integration credentials |\n| `DROPBOX_OAUTH_CLIENT_ID` / `DROPBOX_OAUTH_CLIENT_SECRET` | Dropbox OAuth app credentials |\n| `FIGMA_OAUTH_CLIENT_ID` / `FIGMA_OAUTH_CLIENT_SECRET` | Figma OAuth app credentials |\n| `LINEAR_OAUTH_CLIENT_ID` / `LINEAR_OAUTH_CLIENT_SECRET` | Linear OAuth app credentials |\n| `ASANA_OAUTH_CLIENT_ID` / `ASANA_OAUTH_CLIENT_SECRET` | Asana OAuth app credentials |\n| `ATLASSIAN_OAUTH_CLIENT_ID` / `ATLASSIAN_OAUTH_CLIENT_SECRET` | Atlassian OAuth 2.0 (3LO) app credentials |\n| `GITHUB_TOKEN` | Least-privilege GitHub token for existing owner-level repository tools |
| `VERCEL_TOKEN` | Vercel API token used for approved production deployments |
| `VERCEL_TEAM_ID` | Optional Vercel team ID for team-scoped deployments |
| `GITHUB_OWNER` | Optional default GitHub owner/org |
| `GITHUB_ALLOWED_REPOS` | Optional comma-separated repository allowlist |
| `JARVIS_PLATFORM_ADAPTERS` | Legacy deployment-level identity verification adapters only; not per-user Auth Agent Connections |
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
9. Mount both routers from `python_services/piper_pdf_router.py` into the Piper FastAPI app (or deploy `python_services/pdf_service.py` as a companion), configure `PIPER_API_KEY`, then test PDF, DOCX, XLSX and ZIP generation in a private chat.
10. Configure `VERCEL_TOKEN` and optional `VERCEL_TEAM_ID` in Render, then test a Vercel deployment using a non-critical test project and approve the production deployment only after reviewing it.

## Verification and limitations

The included automated suite covers tool validation, role checks, approval lifecycle, command-template validation, shell-command rejection, platform identity adapter validation, and the poll quiz flow using mocked ALOC/WhatsApp responses. It does not constitute a live WhatsApp, ALOC, Gemini, GitHub, MongoDB, Docker or Render integration test. Those require the operator's own credentials and staging environment.

The group link Watchdog is connected directly to incoming WhatsApp group messages. It detects HTTP/HTTPS URLs, www links, supported bare domains and WhatsApp group invite links, then deletes messages from non-admin members when JARVIS has group-admin permission. Current group admins and JARVIS's own messages are exempt. Moderation uses live WhatsApp group metadata and does not call Gemini or another AI model. If admin status cannot be verified or JARVIS lacks group-admin permission, it leaves the message in place. Blocked-word moderation is not currently enabled.

See [`INTEGRATION-DEPLOYMENT.md`](INTEGRATION-DEPLOYMENT.md) for the end-to-end AI Link, Piper multi-format file service and Vercel setup.


## AI-first planner and external services

Natural-language requests are interpreted by the AI planner and mapped to registered tools. The former local keyword/regex natural-language router has been removed. Tool plans require a confidence value of at least 0.75 and still pass argument, role, rate-limit and approval checks. Deterministic explicit commands remain available. See `INTEGRATION-DEPLOYMENT.md` for the paired AI Link and Piper/PDF deployment steps.


## Vercel deployment and file generation

Website deployments use the Vercel API and return verified `.vercel.app` URLs. Configure `VERCEL_TOKEN` (and optional `VERCEL_TEAM_ID`) in the hosting environment. Production deployment remains approval-gated.

The file creator supports PDF, DOCX, XLSX, PPTX, CSV, TXT, Markdown, HTML, JSON, XML, YAML, CSS, JavaScript, Python, PHP, Java, C++, SQL, SVG, RTF, TypeScript/TSX/JSX, C/C++, C#, Go, Rust, Ruby, shell/PowerShell, TOML, INI, configuration, LaTeX, MDX, JSONL and ZIP. The Python service must be updated and deployed with the dependencies and `/files/generate` route documented in `INTEGRATION-DEPLOYMENT.md`.

## Automatic Flexi WhatsApp Channel quiz

JARVIS runs the weekly ALOC-based native Channel quiz automatically when the WhatsApp socket is online and MongoDB is connected. The schedule uses `Africa/Lagos` time and the existing `FLEXI_CHANNEL_JID` (or the project's existing default Channel JID): Monday starts at 10:00 AM with Mathematics (30); Tuesday Biology and Government (30 each); Wednesday Economics and Chemistry (30 each); Thursday Physics and CRK (30 each); Friday Financial Accounting, Commerce and Literature in English (20 each); Saturday starts at 9:00 AM and covers all ten scheduled subjects (10 each). English Language is intentionally excluded from automatic runs because of the ALOC dataset issue; the manual quiz command remains available.

Weekday questions are published every 4 minutes and explanations every 5 minutes. Saturday questions and explanations are published every 3 minutes. After each subject's question phase, JARVIS announces that it is preparing the answers, asks the configured AI gateway for explanations one question at a time, and posts each answer as a reply to its original Channel poll. Progress and message keys are persisted in MongoDB collection `jarvis_channel_quiz_schedule` so an interrupted run can resume. No new environment variable is required. The existing manual `!channelquiz <subject>` command is retained; `!channelquiz off` stops that manually started sequence, not the autonomous timetable. The group quiz's 30-second timer is unchanged.

## Gemini Live WhatsApp calls (same Baileys account)

JARVIS can optionally answer incoming WhatsApp voice calls using the existing WhatsApp socket and a separate call-media adapter. The adapter uses the HirooSy VoIP engine vendored in Flexi's own `@flexisystems/baileys` package, against the existing WhatsApp socket; it does not install a separate calling package, create a second WhatsApp account, or write a second authentication session.

Set `AI_API_KEY` in the JARVIS hosting environment to the same value as `JARVIS_API_KEY` on the Flexi Educational Consult AI Link. JARVIS connects to the authenticated `/voice` WebSocket endpoint and sends/receives call audio through that service. Gemini API keys remain configured only on the AI Link server; do not add `GEMINI_API_KEY` to JARVIS.

Requirements and limitations:
- The call adapter relies on Baileys internal socket methods. Compatibility with the installed `@flexisystems/baileys` fork must be verified in a real staging call; if setup fails, the normal JARVIS bot continues running and logs the reason.
- The hosting runtime must support the package's Node.js requirements and WhatsApp call media networking. FFmpeg/ffprobe are documented requirements for the package's media features.
- The bridge converts WhatsApp 16 kHz Float32 audio to Gemini 16 kHz PCM16, then converts Gemini 24 kHz PCM16 responses back to 16 kHz Float32 for WhatsApp.
- One concurrent AI call is allowed. Additional incoming calls are rejected while JARVIS is busy.
- This is an experimental unofficial WhatsApp Web calling integration. It is not an official WhatsApp Business Calling API integration, and successful deployment is not proof of live call compatibility. Test with a non-critical account/session first.
- If `AI_API_KEY` is absent, JARVIS retains the previous incoming-call detection and owner-alert behavior only.



## Group Status moderation

JARVIS inspects incoming Group Status stanza metadata before message decryption. It identifies the group and author without reading status text or media, leaves group-admin statuses untouched, and uses the Group Status-specific revoke metadata supported by the Flexi Baileys fork for non-admin posts. Each offending status is deduplicated by group JID and status ID, then recorded through the existing persistent group-scoped anti-status warning counter and three-strike removal flow. JARVIS must be a group admin to revoke the status or remove a member. This is an unofficial WhatsApp Web protocol feature and must be validated in a private staging group; a sent revoke request is not proof that WhatsApp removed the status.

## Direct WhatsApp group status publishing

Group administrators can publish a text status directly to the current group with `!groupstatus [text]`. The command uses `sock.sendGroupStatus()` from `@flexisystems/baileys` and is distinct from personal status mentions.
