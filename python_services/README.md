# Piper PDF routes (Python)

This module adds PDF generation and text extraction to the existing Piper Python service. It does not replace Piper's speech/TTS, YouTube, or other endpoints.

## Mount into Piper (FastAPI)

Copy `piper_pdf_router.py` into the Piper service source tree, install `requirements.txt` dependencies (or merge them into Piper's existing requirements), then register the router in Piper's FastAPI app:

```python
from piper_pdf_router import router as pdf_router
app.include_router(pdf_router)
```

The routes use the existing `PIPER_API_KEY` environment variable and `x-api-key` header. They do not expose PDF operations publicly.

If the Piper service uses a framework other than FastAPI, deploy this module as a small FastAPI companion service instead; set `PIPER_DOCUMENT_API_URL` in JARVIS to that service's base URL.

## Routes

- `POST /pdf/generate` — JSON `{ "title": "...", "content": "...", "filename": "notes.pdf" }`; returns `pdfBase64`.
- `POST /pdf/extract` — JSON `{ "fileBase64": "...", "filename": "source.pdf" }`; returns extracted text and page count.

Limits: 15 MB per uploaded PDF, 100 pages, and 100,000 characters of generated content. Text extraction is not OCR; scanned/image-only PDFs will need OCR added separately if required.

## Standalone deployment

Create a FastAPI app that includes the router, then start it with `uvicorn app:app --host 0.0.0.0 --port $PORT`. Set `PIPER_API_KEY` to the same secret already used by JARVIS.
