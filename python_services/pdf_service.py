"""Standalone FastAPI entry point for the Piper PDF router.

For a single Piper deployment, import and mount `router` from piper_pdf_router
inside the existing Piper FastAPI application instead of starting this app.
"""
from fastapi import FastAPI
from piper_pdf_router import router, files_router

app = FastAPI(title="JARVIS Python File Service", version="1.0.0")
app.include_router(router)
app.include_router(files_router)


@app.get("/health")
def health():
    return {"success": True, "service": "jarvis-python-pdf", "status": "online"}
