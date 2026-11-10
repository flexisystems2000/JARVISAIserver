# Changelog

## 3.0.0 - 2026-11-08
- Removed the obsolete local keyword/regex natural-language router from the runtime and package; natural-language requests go through the AI planner and registered tool registry.
- Added explicit AI tool-plan confidence validation; low-confidence plans are clarified instead of executed.
- Expanded registered-tool argument validation for numbers, booleans, arrays, and string/item length constraints.
- Preserved the existing approval, role, audit, GitHub and sandbox components.
- Made native WhatsApp polls the only quiz mode; disabled legacy A-D text-answer scoring and removed persisted student score storage.
- Integrated authenticated ReportLab/PyMuPDF PDF generation and extraction routes directly into the existing Piper FastAPI service without changing Piper TTS.
- Kept existing YouTube, NovaStack and Magic Hour integrations.
- Updated package checks and documentation.

# Changelog

## 2.7.0 — 2026-11-07
- Added a platform connector registry with provider-side identity verification.
- Added built-in GitHub account verification and configurable HTTPS REST identity adapters.
- Added a read-only GitHub repository security triage tool for likely committed secrets and tracked live environment files.
- Kept platform credentials in hosting environment variables; no chat-based password or OTP collection.
- Removed Grammar Watchdog from runtime imports and files.
- Preserved the existing ALOC subject mapping and reply-based quiz implementation.
- Documented that native WhatsApp poll voting/30-second progression is not enabled pending verification of the bundled Baileys fork's poll-update contract.
- Kept repository writes/deletes out of the AI tool registry; destructive actions are not silently executed.

## Validation
- `npm run check`: passed (JavaScript syntax checks).
- `npm test`: six unit tests; results recorded in delivery notes.
- Runtime integration with WhatsApp, Gemini, MongoDB, GitHub, Docker and Render was not executed in this environment. Install dependencies and test with staging credentials before production deployment.

## 2.8.0 — 2026-11-07
- Added native ALOC WhatsApp poll quizzes with a 30-second voting period, aggregate tally support, AI explanations and automatic next-question progression.
- Added `!stopquiz`; quiz mode is now poll-only with no individual student score storage.
- Added a persistent, expiring, single-use owner approval queue with `!approvals`, `!approve <ID>` and `!reject <ID>`.
- Added approval-gated GitHub file write/delete tools with provider-side repository permission checks.
- Added AI tools to list and create safe text-template commands; command persistence requires owner approval.
- Added repository-admin verification and optional GitHub repository allowlisting.
- Switched the socket runtime to the already-used `@innovatorssoft/baileys` package and removed `@musteqeem/baileys` from dependencies after a third-party security report flagged version 1.0.7 for injecting undisclosed newsletter attribution into outgoing media. This is a risk-reduction change, not a full dependency audit.
- Expanded README and environment documentation; retained existing bot features and removed Grammar Watchdog.

## 2.8.0 validation
- `npm run check`: passed.
- `npm test`: 13 tests passed.
- Live WhatsApp, ALOC, Gemini, GitHub, MongoDB, Docker and Render integration tests were not run in this environment.


## 2.9.0 integration update
- Routed JARVIS model requests through configurable `AI_API_URL` with shared-key authentication and request timeouts.
- Enabled JSON-mode AI responses for the JARVIS agent planner; tool registry authorization and validation remain authoritative.
- Removed JARVIS dependence on the retired AI Link `/pdf` route; PDF text extraction now calls the Python document service.
- Routed study PDF creation through Python/ReportLab and return the generated PDF to WhatsApp.
- Added FastAPI PDF generate/extract routes for mounting into the existing Piper Python service; Piper TTS remains intact.
- Kept ALOC poll quiz orchestration and 30-second vote flow inside JARVIS.
- Live Piper route deployment and WhatsApp/ALOC/Gemini/GitHub integrations still require staging credentials and end-to-end testing.


## 3.1.0 — 2026-11-09
- Fixed Watchdog false positives by matching blocked terms as whole words; ordinary words such as `code` no longer match the blocked token `ode`.
- Added a fresh WhatsApp group-admin verification path with participant ID, phone-number and LID matching; verified group admins are excluded from Watchdog moderation.
- Enabled WhatsApp group admins to approve/reject actions requested in their own group; JARVIS owner and configured system admins retain global approval authority.
- Scoped group-admin approval lists to the requesting group and recorded the actual approver in the audit trail.
- Restored direct `!command list` and `!command create name | description | template` flows. Custom commands remain restricted to safe templates, require approval before persistence, and can be invoked as `!command_name` by authorised admins.
- Added Agent tools for image generation through the existing authenticated AI Link `/image` endpoint and for locking/unlocking groups through the existing Baileys group-setting API.
- Added an approval-gated GitHub Pages static-site creation/deployment tool that returns the configured Pages URL after publishing site files.
- Removed the free-form AI fallback after Agent execution errors so JARVIS does not imply an action succeeded when its tool execution failed.
- Preserved `@innovatorssoft/baileys`, existing Piper TTS, AI Link authentication, existing bot integrations and quiz behavior.
- Added regression tests for Watchdog matching, group-scoped approvals and dynamic command execution.

## 3.1.0 validation
- `npm run check`: passed.
- `npm test`: 19 tests passed.
- Live WhatsApp moderation/admin checks, GitHub repository creation/Pages publishing, AI Link image generation, MongoDB and Render deployment were not executed in this environment.
