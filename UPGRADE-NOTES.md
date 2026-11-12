# JARVIS AI upgrade notes — November 2026

## Protected architecture
- Existing WhatsApp bot structure and frontend are retained. `!ai` remains on its existing flow.
- No new AI Agent or central router was introduced. The existing AI Agent now uses compact tool discovery, schema validation, one argument-correction attempt, duplicate-step protection and bounded multi-step execution.

## Removed commands
- `!define`, `!dictionary` and `!translate` are removed from the command registry, menu, natural-language router and direct command handling.

## AI Agent command access
- Added tools for file creation, timetable delivery, quiz start/stop, reminders, voice preferences, YouTube search/video/audio delivery, video generation/status, website inspection, system status, chat/group information, learner profile names, payment requests, health snapshots and command menu display.
- Added protected group-member add/remove/promote/ban/unban and warning-reset tools. Group membership changes require approval and re-check that the original requester remains a current group admin.
- Existing group mute/unmute, group-name and image-generation tools remain available. The bulk `!remove all` operation is exposed only through an explicit approval-gated tool. View-once media retrieval is not exposed as an AI Agent tool.

## GitHub and Vercel
- GitHub repository listing, tree inspection, file reading and code search now allow owner, configured system admins and current WhatsApp group admins. Write/delete operations remain approval-gated.
- Removed the GitHub Pages publisher. Website creation and repository-to-website deployment now use Vercel and return a `.vercel.app` URL only after Vercel reports READY and the URL responds successfully.
- Configure `VERCEL_TOKEN` and optional `VERCEL_TEAM_ID` in the protected hosting environment. Direct upload supports static/text project files (up to 100 files, 1 MB per file, 8 MB total); framework projects needing dependency installation/build steps require a linked Vercel Git integration or CLI deployment workflow.

## Multi-format file creation
- `!createfile` and the AI Agent `file_create` tool support PDF, DOCX, XLSX, PPTX, CSV, TXT, Markdown, HTML, JSON, XML, YAML/YML, CSS, JavaScript, Python, PHP, Java, C++, SQL, SVG, RTF, TypeScript/TSX/JSX, C/C++, C#, Go, Rust, Ruby, shell/PowerShell, TOML, INI, configuration, LaTeX, MDX, JSONL and ZIP.
- The authenticated Python service exposes `/files/generate`; install the updated `python_services/requirements.txt` and mount both routers in the deployed service. Existing `/pdf/*` routes remain.
- PDF remains the default when no format is specified.

## Validation
- `npm run check`: passed.
- `node --test`: 57 passed, 0 failed.
- Python document-service tests: 7 passed, 0 failed; Python syntax compilation: passed.
- Live WhatsApp, GitHub, Vercel, MongoDB, AI Link and deployed Piper integration checks were not possible in this local ZIP-editing session.

## Required deployment configuration
See `.env.example` and `INTEGRATION-DEPLOYMENT.md`. Do not put secrets in source control or WhatsApp messages.


## Stage 1 — GitHub and Vercel hardening (2026-11-12)

- Added owner-approved GitHub repository creation (private by default; organization creation depends on the configured token's organization permissions).
- Added approval-gated batch file uploads using one Git commit, with path, duplicate, file-count and size validation.
- Normalized the planner's `repository` argument alias to the registered `repo` field, including `owner/repo` values.
- Honoured the explicit WhatsApp owner context in permission checks.
- Blocked direct Vercel file deployments for projects that require framework builds; static deployments remain supported and Vercel team scoping uses `VERCEL_TEAM_ID`.
- Kept the existing frontend, WhatsApp architecture, `!ai`, quiz engine and reminder implementation unchanged.
