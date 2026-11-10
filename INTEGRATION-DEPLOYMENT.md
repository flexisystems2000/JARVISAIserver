# JARVIS 3.0.0 + AI Link 1.4.0 + Piper/PDF integration

## Service responsibilities

- **JARVIS (Node/WhatsApp):** conversation memory, AI-first intent planning, registered tools, permissions, approvals, audit logs, GitHub administration, ALOC quizzes and WhatsApp polls.
- **Flexieduconsult AI Link 1.4.0:** authenticated Gemini gateway for reasoning, image understanding, grammar and image generation. JSON-mode requests are checked for valid JSON-object output.
- **Piper Python service:** keeps the existing Piper voice and `/tts` behavior, YouTube routes, NovaStack and Magic Hour integrations. It now also mounts authenticated PDF generation and extraction routes.
- **PDF:** ReportLab generates PDFs; PyMuPDF extracts text from text-based PDFs.

## Deployment order

1. Deploy **AI Link 1.4.0**. Set `JARVIS_API_KEY` and at least one `GEMINI_API_KEY_1`. Add optional key-rotation entries only if needed.
2. Set JARVIS `AI_API_URL` to the AI Link base URL and `AI_API_KEY` to the exact same secret as AI Link `JARVIS_API_KEY`.
3. Deploy the updated **Flexi-Jarvis-Piper-TTS** project. Its `app.py` mounts `piper_pdf_router.py` directly. The Dockerfile copies both files, and `requirements.txt` includes ReportLab and PyMuPDF. Keep the existing Piper voice/model and the other media integrations.
4. Set the same `PIPER_API_KEY` on JARVIS and the Piper service. Set JARVIS `PIPER_DOCUMENT_API_URL` to the Piper service base URL.
5. Deploy **JARVIS 3.0.0**. Keep existing production environment values; use `.env.example` as the reference for names.

## Required service settings

| Variable | Where | Purpose |
|---|---|---|
| `AI_API_URL` | JARVIS | AI Link base URL |
| `AI_API_KEY` | JARVIS | Same secret as AI Link `JARVIS_API_KEY` |
| `JARVIS_API_KEY` | AI Link | Shared secret for private service calls |
| `GEMINI_API_KEY_1` | AI Link | Primary Gemini key |
| `PIPER_API_KEY` | JARVIS and Piper | Shared secret for Piper and PDF calls |
| `PIPER_DOCUMENT_API_URL` | JARVIS | Piper service base URL |
| `OWNER_NUMBER` | JARVIS | WhatsApp owner number, digits only |
| `MONGO_URI` | JARVIS | MongoDB connection string, if using persistence |

Optional integrations: `ALOC_TOKEN`, `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_ALLOWED_REPOS`, `NOVASTACK_KEY`, `MAGIC_HOUR_API_KEY`/`MAGIC_HOUR_API_KEYS`, and platform-specific tokens. Do not configure integrations you do not use.

## Smoke tests

- `GET <AI_API_URL>/test` reports the AI Link online.
- An authenticated `/ai` request with `responseFormat: "json"` returns a JSON object.
- JARVIS can answer an ordinary AI question and use a registered tool when the AI plan is sufficiently confident and the actor is authorised.
- `!quiz off` stops only the active quiz in the current group.
- JARVIS uses the WhatsApp push/profile name when available and does not invent a name when unavailable.
- `!command list` and `!command create name | description | template` exercise the approval-gated Command Inventor.
- Ask JARVIS to create a static website; approve the pending GitHub deployment, then verify the returned GitHub Pages URL.
- `POST <PIPER_DOCUMENT_API_URL>/pdf/generate` returns a valid PDF when called with `x-api-key`.
- `POST <PIPER_DOCUMENT_API_URL>/pdf/extract` extracts text from a text-based PDF.
- Piper `/tts` continues to generate the same voice output as before.
- YouTube, NovaStack and Magic Hour endpoints remain available.
- `!quiz Mathematics` fetches from ALOC, publishes a 30-second poll, explains the answer, advances automatically and does not update student scores.

## Important limitations

- The generic platform-auth mechanism verifies configured provider tokens; it does not magically integrate every website. Each platform needs a real provider adapter and resource-level permission checks.
- Dynamic command builder currently persists safe text-template commands only; it does not generate arbitrary executable programs.
- The Coding Agent currently creates static GitHub Pages websites only. Dynamic backend deployment needs an explicit provider adapter and deployment workflow.
- PDF extraction handles text-based PDFs. OCR for scanned/image-only PDFs is not included.
- The existing Render instance with 0.5 CPU / 512 MB RAM should not be assumed to support heavier workloads. Piper's current hosting/runtime constraints are unchanged by this package.
- The included tests are local unit/syntax tests; live WhatsApp, Gemini, ALOC, Piper and external-provider integration tests require deployment credentials and a controlled test account.

Never paste credentials into WhatsApp or commit real secrets to source control. Configure secrets in the hosting provider's environment settings.
