# JARVIS document and multi-format file service

This FastAPI service provides authenticated PDF extraction and general file generation. It can run as a standalone companion service or be mounted into the existing Piper FastAPI app. It does not replace Piper TTS, YouTube or video endpoints.

## Mount into an existing Piper FastAPI service

Install the packages in `requirements.txt` (merge them into the Piper service requirements), then mount both routers:

```python
from piper_pdf_router import router as pdf_router, files_router
app.include_router(pdf_router)
app.include_router(files_router)
```

Set `PIPER_API_KEY` in the service and configure the same value as `PIPER_API_KEY` in JARVIS. Requests use the `x-api-key` header.

## Routes

- `POST /pdf/generate` — generate a PDF from title/content; returns `pdfBase64`.
- `POST /pdf/extract` — extract text from a PDF; returns text and page count.
- `POST /files/generate` — create PDF, DOCX, XLSX, PPTX, CSV, TXT, Markdown, HTML, JSON, XML, YAML/YML, CSS, JavaScript, Python, PHP, Java, C++, SQL, SVG, RTF, TypeScript/TSX/JSX, C/C++, C#, Go, Rust, Ruby, shell/PowerShell, TOML, INI, configuration, LaTeX, MDX, JSONL or ZIP; returns `fileBase64` and MIME type.

General file generation accepts `{ "filename": "notes.docx", "title": "Notes", "content": "..." }`. ZIP generation accepts a `files` array of `{ "path": "relative/path", "content": "..." }` entries. XLSX/CSV content should be JSON tabular data; PPTX content should be a JSON object with a `slides` array.

Limits: 15 MB generated/uploaded file size, up to 100 ZIP entries, and 2 million characters for a general text payload. HTML/SVG content is stripped of script-like elements and common inline event attributes. ZIP paths are checked to prevent traversal.

## Standalone deployment

`pdf_service.py` mounts both routers. Run it with `uvicorn pdf_service:app --host 0.0.0.0 --port $PORT`. Point `PIPER_DOCUMENT_API_URL` in JARVIS to the service base URL.
