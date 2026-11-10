"""Authenticated document-generation and PDF extraction routes for Piper/FastAPI.

Mount in Piper's FastAPI application:
    from piper_pdf_router import router as pdf_router
    app.include_router(pdf_router)

The router uses the same PIPER_API_KEY shared secret already used by JARVIS.
"""
from __future__ import annotations

import base64
import binascii
import csv
import hmac
import json
import os
import re
from html import escape as html_escape
from io import BytesIO, StringIO
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer
from xml.sax.saxutils import escape

import bleach
from docx import Document
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Pt

router = APIRouter(prefix="/pdf", tags=["Document generation and PDF extraction"])
MAX_PDF_BYTES = 15 * 1024 * 1024
MAX_TEXT_CHARS = 100_000
MAX_GENERATED_FILE_BYTES = 15 * 1024 * 1024
SUPPORTED_FILE_FORMATS = {"pdf", "docx", "xlsx", "pptx", "csv", "txt", "md", "html", "json"}
FILE_MIME_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "csv": "text/csv; charset=utf-8",
    "txt": "text/plain; charset=utf-8",
    "md": "text/markdown; charset=utf-8",
    "html": "text/html; charset=utf-8",
    "json": "application/json; charset=utf-8",
}


class GenerateRequest(BaseModel):
    title: str = Field(default="JARVIS Document", max_length=160)
    content: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    filename: str = Field(default="JARVIS_Document.pdf", max_length=100)


class GenerateFileRequest(BaseModel):
    format: str = Field(default="pdf", pattern=r"^(pdf|docx|xlsx|pptx|csv|txt|md|html|json)$")
    title: str = Field(default="JARVIS Document", max_length=160)
    content: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    filename: str = Field(default="JARVIS_Document", max_length=160)


class ExtractRequest(BaseModel):
    fileBase64: str = Field(min_length=1)
    filename: str = Field(default="document.pdf", max_length=160)


def _authorize(x_api_key: str | None) -> None:
    expected = os.getenv("PIPER_API_KEY", "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="Document API authentication is not configured")
    if not x_api_key or not hmac.compare_digest(x_api_key.strip(), expected):
        raise HTTPException(status_code=401, detail="Unauthorized service client")


def _decode_pdf(encoded: str) -> bytes:
    clean = re.sub(r"^data:application/pdf;base64,", "", encoded.strip(), flags=re.I)
    try:
        raw = base64.b64decode(clean, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Invalid base64 PDF payload")
    if len(raw) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds the 15 MB limit")
    if not raw.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="Uploaded file is not a valid PDF")
    return raw


def _safe_filename(value: str) -> str:
    name = Path(value or "JARVIS_Document.pdf").name
    name = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("._")[:96]
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    return name or "JARVIS_Document.pdf"


def _make_pdf(title: str, content: str) -> bytes:
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        rightMargin=19 * mm, leftMargin=19 * mm,
        topMargin=20 * mm, bottomMargin=20 * mm,
        title=title[:160], author="JARVIS — Flexi Digital Academy",
    )
    base = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "JarvisTitle", parent=base["Title"], fontName="Helvetica-Bold",
        fontSize=19, leading=24, alignment=TA_LEFT, textColor=colors.HexColor("#17365D"),
        spaceAfter=10,
    )
    heading_style = ParagraphStyle(
        "JarvisHeading", parent=base["Heading2"], fontName="Helvetica-Bold",
        fontSize=12, leading=16, textColor=colors.HexColor("#1F4E79"),
        spaceBefore=10, spaceAfter=5,
    )
    body_style = ParagraphStyle(
        "JarvisBody", parent=base["BodyText"], fontName="Helvetica",
        fontSize=10, leading=14, spaceAfter=6,
    )
    story: list[Any] = [Paragraph(escape(title.strip() or "JARVIS Document"), title_style),
                        HRFlowable(width="100%", thickness=0.8, color=colors.HexColor("#8FAADC")),
                        Spacer(1, 10)]
    for raw_line in content.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.strip()
        if not line:
            story.append(Spacer(1, 4))
            continue
        if line.startswith("### "):
            story.append(Paragraph(escape(line[4:]), heading_style))
        elif line.startswith("## "):
            story.append(Paragraph(escape(line[3:]), heading_style))
        elif line.startswith("# "):
            story.append(Paragraph(escape(line[2:]), heading_style))
        elif line.startswith(("- ", "* ", "• ")):
            story.append(Paragraph("&#8226;&nbsp;" + escape(line[2:]), body_style))
        else:
            story.append(Paragraph(escape(line), body_style))
    doc.build(story)
    return buffer.getvalue()

def _safe_output_filename(value: str, file_format: str) -> str:
    """Return a basename with a forced, allow-listed extension."""
    raw = Path(str(value or "JARVIS_Document").replace("\\", "/")).name
    stem = Path(raw).stem if Path(raw).suffix else raw
    stem = re.sub(r"[^A-Za-z0-9_-]+", "_", stem).strip("._-")[:80]
    return f"{stem or 'JARVIS_Document'}.{file_format}"


def _parse_json_content(content: str) -> Any:
    candidate = content.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", candidate, flags=re.I | re.S)
    if fenced:
        candidate = fenced.group(1)
    try:
        return json.loads(candidate)
    except (json.JSONDecodeError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="This file format requires valid JSON content from the AI generator") from exc


def _safe_cell(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False)
    text = str(value)
    # Prevent spreadsheet formula injection while retaining legitimate numeric values.
    if text.startswith(("=", "+", "-", "@")) and not re.fullmatch(r"[-+]?\d+(?:\.\d+)?", text.strip()):
        return "'" + text
    return text


def _normalise_table(content: str) -> tuple[list[str], list[list[Any]]]:
    try:
        data = _parse_json_content(content)
    except HTTPException:
        try:
            parsed_rows = list(csv.reader(StringIO(content)))
        except csv.Error as exc:
            raise HTTPException(status_code=422, detail="CSV/XLSX content must be a JSON table or valid CSV text") from exc
        if not parsed_rows:
            raise HTTPException(status_code=422, detail="CSV/XLSX content contains no rows")
        headers = [str(value) or f"Column {i + 1}" for i, value in enumerate(parsed_rows[0])][:100]
        return headers, [row[:100] for row in parsed_rows[1:10001]]

    if isinstance(data, dict) and isinstance(data.get("sheets"), list):
        data = data["sheets"][0] if data["sheets"] else {}
    if isinstance(data, dict) and isinstance(data.get("headers"), list) and isinstance(data.get("rows"), list):
        headers = [str(value)[:128] for value in data["headers"][:100]]
        rows = data["rows"][:10000]
        normalised = []
        for row in rows:
            if isinstance(row, dict):
                normalised.append([_safe_cell(row.get(header)) for header in headers])
            elif isinstance(row, (list, tuple)):
                normalised.append([_safe_cell(value) for value in list(row)[:len(headers)]])
            else:
                normalised.append([_safe_cell(row)])
        return headers or ["Value"], normalised
    if isinstance(data, list) and data and all(isinstance(row, dict) for row in data):
        headers = list(dict.fromkeys(key for row in data[:10000] for key in row.keys()))[:100]
        return [str(key)[:128] for key in headers], [[_safe_cell(row.get(key)) for key in headers] for row in data[:10000]]
    if isinstance(data, list) and data and all(isinstance(row, (list, tuple)) for row in data):
        headers = [str(value)[:128] for value in list(data[0])[:100]]
        if not headers:
            raise HTTPException(status_code=422, detail="Table data must include column headers")
        return headers, [[_safe_cell(value) for value in list(row)[:len(headers)]] for row in data[1:10001]]
    if isinstance(data, dict):
        return ["Field", "Value"], [[_safe_cell(key), _safe_cell(value)] for key, value in list(data.items())[:10000]]
    if isinstance(data, list):
        return ["Value"], [[_safe_cell(value)] for value in data[:10000]]
    raise HTTPException(status_code=422, detail="CSV/XLSX content must describe tabular data")


def _make_csv(content: str) -> bytes:
    headers, rows = _normalise_table(content)
    output = StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(headers)
    for row in rows:
        writer.writerow([_safe_cell(value) for value in row])
    return output.getvalue().encode("utf-8")


def _make_xlsx(title: str, content: str) -> bytes:
    data = _parse_json_content(content)
    sheet_specs = data.get("sheets") if isinstance(data, dict) else None
    if isinstance(sheet_specs, list) and sheet_specs:
        pass
    else:
        headers, rows = _normalise_table(content)
        sheet_specs = [{"name": "Data", "headers": headers, "rows": rows}]
    if len(sheet_specs) > 10:
        raise HTTPException(status_code=413, detail="An Excel workbook can contain at most 10 sheets")

    workbook = Workbook()
    workbook.remove(workbook.active)
    used_names: set[str] = set()
    for index, spec in enumerate(sheet_specs):
        if not isinstance(spec, dict):
            spec = {"headers": ["Value"], "rows": [[spec]]}
        sheet_name = re.sub(r"[\[\]:*?/\\]", "_", str(spec.get("name") or ("Data" if index == 0 else f"Sheet {index + 1}")))[:31].strip("'") or f"Sheet{index + 1}"
        base_name, suffix = sheet_name, 1
        while sheet_name.lower() in used_names:
            tail = f"_{suffix}"
            sheet_name = base_name[:31-len(tail)] + tail
            suffix += 1
        used_names.add(sheet_name.lower())
        ws = workbook.create_sheet(sheet_name)
        headers, rows = _normalise_table(json.dumps(spec, ensure_ascii=False))
        ws.append([_safe_cell(value) for value in headers])
        for row in rows:
            ws.append([_safe_cell(value) for value in row])
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions
        for column_cells in ws.columns:
            max_length = min(max((len(str(cell.value or "")) for cell in column_cells), default=10), 48)
            ws.column_dimensions[column_cells[0].column_letter].width = max(12, max_length + 2)
    output = BytesIO()
    workbook.properties.title = str(title or "JARVIS Workbook")[:160]
    workbook.save(output)
    return output.getvalue()


def _make_docx(title: str, content: str) -> bytes:
    document = Document()
    document.core_properties.title = str(title or "JARVIS Document")[:160]
    document.add_heading(str(title or "JARVIS Document"), level=0)
    for raw_line in content.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.strip()
        if not line:
            document.add_paragraph("")
        elif line.startswith("### "):
            document.add_heading(line[4:], level=3)
        elif line.startswith("## "):
            document.add_heading(line[3:], level=2)
        elif line.startswith("# "):
            document.add_heading(line[2:], level=1)
        elif line.startswith(("- ", "* ", "• ")):
            document.add_paragraph(line[2:], style="List Bullet")
        elif re.match(r"^\d+[.)]\s+", line):
            document.add_paragraph(re.sub(r"^\d+[.)]\s+", "", line), style="List Number")
        else:
            document.add_paragraph(line)
    output = BytesIO()
    document.save(output)
    return output.getvalue()


def _normalise_slides(content: str) -> list[dict[str, Any]]:
    data = _parse_json_content(content)
    slides = data.get("slides") if isinstance(data, dict) else data
    if not isinstance(slides, list) or not slides:
        raise HTTPException(status_code=422, detail="PowerPoint content must be JSON with a non-empty slides array")
    if len(slides) > 60:
        raise HTTPException(status_code=413, detail="A PowerPoint file can contain at most 60 slides")
    result = []
    for index, item in enumerate(slides):
        if isinstance(item, str):
            result.append({"title": f"Slide {index + 1}", "bullets": [item], "body": ""})
        elif isinstance(item, dict):
            bullets = item.get("bullets", item.get("points", []))
            if isinstance(bullets, str):
                bullets = [bullets]
            if not isinstance(bullets, list):
                bullets = []
            result.append({
                "title": str(item.get("title") or f"Slide {index + 1}")[:200],
                "bullets": [str(value)[:2000] for value in bullets[:15]],
                "body": str(item.get("body") or item.get("notes") or "")[:5000],
            })
        else:
            result.append({"title": f"Slide {index + 1}", "bullets": [str(item)[:2000]], "body": ""})
    return result


def _make_pptx(title: str, content: str) -> bytes:
    presentation = Presentation()
    presentation.core_properties.title = str(title or "JARVIS Presentation")[:160]
    for spec in _normalise_slides(content):
        layout = presentation.slide_layouts[1] if len(presentation.slide_layouts) > 1 else presentation.slide_layouts[0]
        slide = presentation.slides.add_slide(layout)
        if slide.shapes.title:
            slide.shapes.title.text = spec["title"]
        if len(slide.placeholders) > 1:
            frame = slide.placeholders[1].text_frame
            frame.clear()
            items = spec["bullets"] or ([spec["body"]] if spec["body"] else [])
            for item_index, value in enumerate(items):
                paragraph = frame.paragraphs[0] if item_index == 0 else frame.add_paragraph()
                paragraph.text = value
                paragraph.level = 0
                paragraph.font.size = Pt(20)
            if spec["body"] and spec["bullets"]:
                paragraph = frame.add_paragraph()
                paragraph.text = spec["body"]
                paragraph.font.size = Pt(14)
    output = BytesIO()
    presentation.save(output)
    return output.getvalue()


def _make_html(title: str, content: str) -> bytes:
    allowed_tags = {"a", "blockquote", "br", "code", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "ol", "p", "pre", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul"}
    clean_body = bleach.clean(
        content, tags=allowed_tags, attributes={"a": ["href", "title"]},
        protocols={"http", "https", "mailto"}, strip=True, strip_comments=True,
    )
    page = (
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<title>{html_escape(str(title or 'JARVIS Document'))}</title></head><body>"
        f"{clean_body}</body></html>"
    )
    return page.encode("utf-8")


def _generate_file_bytes(file_format: str, title: str, content: str) -> bytes:
    fmt = str(file_format or "").lower().lstrip(".")
    if fmt not in SUPPORTED_FILE_FORMATS:
        raise HTTPException(status_code=415, detail="Unsupported file format")
    if not content or len(content) > MAX_TEXT_CHARS:
        raise HTTPException(status_code=413, detail="Generated content is empty or exceeds the 100,000-character limit")
    if fmt == "pdf":
        output = _make_pdf(title, content)
    elif fmt == "docx":
        output = _make_docx(title, content)
    elif fmt == "xlsx":
        output = _make_xlsx(title, content)
    elif fmt == "pptx":
        output = _make_pptx(title, content)
    elif fmt == "csv":
        output = _make_csv(content)
    elif fmt == "json":
        parsed = _parse_json_content(content)
        output = (json.dumps(parsed, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    elif fmt == "html":
        output = _make_html(title, content)
    else:  # txt / md
        output = content.encode("utf-8")
    if len(output) > MAX_GENERATED_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Generated file exceeds the 15 MB limit")
    return output

@router.post("/generate")
def generate_pdf(payload: GenerateRequest, x_api_key: str | None = Header(default=None)):
    _authorize(x_api_key)
    pdf_bytes = _make_pdf(payload.title, payload.content)
    return {
        "success": True,
        "filename": _safe_filename(payload.filename),
        "mimeType": "application/pdf",
        "pdfBase64": base64.b64encode(pdf_bytes).decode("ascii"),
    }


@router.post("/generate-file")
def generate_file(payload: GenerateFileRequest, x_api_key: str | None = Header(default=None)):
    _authorize(x_api_key)
    file_format = payload.format.lower()
    file_bytes = _generate_file_bytes(file_format, payload.title, payload.content)
    return {
        "success": True,
        "filename": _safe_output_filename(payload.filename, file_format),
        "mimeType": FILE_MIME_TYPES[file_format],
        "fileBase64": base64.b64encode(file_bytes).decode("ascii"),
        "sizeBytes": len(file_bytes),
    }


@router.post("/extract")
def extract_pdf(payload: ExtractRequest, x_api_key: str | None = Header(default=None)):
    _authorize(x_api_key)
    raw = _decode_pdf(payload.fileBase64)
    try:
        with fitz.open(stream=raw, filetype="pdf") as document:
            if document.page_count > 100:
                raise HTTPException(status_code=413, detail="PDF exceeds the 100-page limit")
            text_parts = [page.get_text("text") for page in document]
            extracted = "\n\n".join(part for part in text_parts if part.strip()).strip()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail="PDF could not be read") from exc
    return {
        "success": True,
        "filename": _safe_filename(payload.filename),
        "pageCount": len(text_parts),
        "text": extracted[:MAX_TEXT_CHARS],
        "hasExtractableText": bool(extracted),
    }
