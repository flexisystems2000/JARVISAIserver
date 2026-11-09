# JARVIS 3.3.0 + AI Link 1.5.0 + Piper/PDF integration

## Service responsibilities

- **JARVIS (Node/WhatsApp):** conversation memory, AI-first intent planning, registered tools, permissions, approvals, audit logs, GitHub administration, ALOC quizzes and WhatsApp polls.
- **Flexieduconsult AI Link 1.4.0:** authenticated Gemini gateway for reasoning, image understanding, grammar and image generation. JSON-mode requests are checked for valid JSON-object output.
- **Piper Python service:** keeps the existing Piper voice and `/tts` behavior, YouTube routes, NovaStack and Magic Hour integrations. It now also mounts authenticated PDF generation and extraction routes.
- **PDF:** ReportLab generates PDFs; PyMuPDF extracts text from text-based PDFs.

## Deployment order

1. Deploy **AI Link 1.5.0**. Set `JARVIS_API_KEY` and at least one `GEMINI_API_KEY_1`. Add optional key-rotation entries only if needed.
2. Set JARVIS `AI_API_URL` to the AI Link base URL and `AI_API_KEY` to the exact same secret as AI Link `JARVIS_API_KEY`.
3. Deploy the updated **Flexi-Jarvis-Piper-TTS** project. Its `app.py` mounts `piper_pdf_router.py` directly. The Dockerfile copies both files, and `requirements.txt` includes ReportLab and PyMuPDF. Keep the existing Piper voice/model and the other media integrations.
4. Set the same `PIPER_API_KEY` on JARVIS and the Piper service. Set JARVIS `PIPER_DOCUMENT_API_URL` to the Piper service base URL.
5. Deploy **JARVIS 3.3.0**. Keep existing production environment values; use `.env.example` as the reference for names.

## Required service settings

| Variable | Where | Purpose |
|---|---|---|
| `AI_API_URL` | JARVIS | AI Link base URL |
| `AI_API_KEY` | JARVIS | Same secret as AI Link `JARVIS_API_KEY` |
| `JARVIS_API_KEY` | AI Link | Shared secret for private service calls |
| `GEMINI_API_KEY_1` | AI Link | Primary Gemini key |
| `AI_MAX_PROMPT_CHARS` | AI Link | Optional lower prompt ceiling; default 50,000 chars |
| `AI_MAX_REQUEST_BYTES` | AI Link | Optional serialized request cap; default 12 MB |
| `JARVIS_AGENT_PROMPT_MAX_CHARS` | JARVIS | Planner prompt budget, clamped to 35,000–40,000; default 38,000 |
| `JARVIS_AI_MAX_PROMPT_CHARS` | JARVIS | Shared AI adapter prompt cap, clamped to 35,000–40,000; default 38,000 |
| `PIPER_API_KEY` | JARVIS and Piper | Shared secret for Piper and PDF calls |
| `PIPER_DOCUMENT_API_URL` | JARVIS | Piper service base URL |
| `OWNER_NUMBER` | JARVIS | WhatsApp owner number, digits only |
| `MONGO_URI` | JARVIS | MongoDB connection string, if using persistence |

Optional integrations: `ALOC_TOKEN`, `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_ALLOWED_REPOS`, `NOVASTACK_KEY`, `MAGIC_HOUR_API_KEY`/`MAGIC_HOUR_API_KEYS`, and platform-specific tokens. Do not configure integrations you do not use.

## Smoke tests

- `GET <AI_API_URL>/test` reports the AI Link online.
- An authenticated `/ai` request with `responseFormat: "json"` returns a JSON object and an `x-correlation-id` header.
- A prompt over JARVIS's configured prompt budget is rejected before the HTTP request; an AI Link prompt over its gateway ceiling returns structured HTTP 413 diagnostics.
- Review logs by correlation ID to compare prompt characters, serialized request bytes, response format, model and error class.
- JARVIS can answer an ordinary AI question and use a registered tool when the AI plan is sufficiently confident and the actor is authorised.
- `POST <PIPER_DOCUMENT_API_URL>/pdf/generate` returns a valid PDF when called with `x-api-key`.
- `POST <PIPER_DOCUMENT_API_URL>/pdf/extract` extracts text from a text-based PDF.
- Piper `/tts` continues to generate the same voice output as before.
- YouTube, NovaStack and Magic Hour endpoints remain available.
- `!quiz Mathematics` fetches from ALOC, publishes a 30-second poll, explains the answer, advances automatically and does not update student scores.

## Important limitations

- The generic platform-auth mechanism verifies configured provider tokens; it does not magically integrate every website. Each platform needs a real provider adapter and resource-level permission checks.
- Dynamic command builder currently persists safe text-template commands only; it does not generate arbitrary executable programs.
- PDF extraction handles text-based PDFs. OCR for scanned/image-only PDFs is not included.
- The existing Render instance with 0.5 CPU / 512 MB RAM should not be assumed to support heavier workloads. Piper's current hosting/runtime constraints are unchanged by this package.
- The included tests are local unit/syntax tests; live WhatsApp, Gemini, ALOC, Piper and external-provider integration tests require deployment credentials and a controlled test account.

Never paste credentials into WhatsApp or commit real secrets to source control. Configure secrets in the hosting provider's environment settings.

## Planner behavior in 3.3.0

The first model call receives a compact, role-filtered tool catalog without full schemas. The model selects up to eight candidate tools; the second call receives detailed schemas only for those candidates and returns a plan of up to five ordered steps. JARVIS validates the complete plan—including nested object and array arguments—before any side effect. It makes one correction attempt for invalid structured output. An approval-pending result pauses the remaining steps. Existing WhatsApp command dispatch, all 68 command forms, owner/system-admin checks, live group-admin checks and Piper voice routes remain in place.

Run `npm test` and `npm run check` in both Node projects before deploying. Live WhatsApp, Gemini, ALOC and Piper smoke tests still require the production/staging credentials and a controlled test group.
