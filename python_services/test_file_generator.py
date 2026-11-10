import base64
import csv
import io
import json
import os
import unittest

import fitz
from docx import Document
from fastapi import HTTPException
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from pptx import Presentation

from pdf_service import app

from piper_pdf_router import (
    GenerateFileRequest,
    GenerateRequest,
    _generate_file_bytes,
    _safe_output_filename,
    generate_file,
    generate_pdf,
    extract_pdf,
    ExtractRequest,
)


class GeneralFileGeneratorTests(unittest.TestCase):
    def setUp(self):
        os.environ['PIPER_API_KEY'] = 'unit-test-secret'

    def test_all_nine_formats_generate_valid_files(self):
        table = json.dumps([
            {"name": "Ada", "score": 95},
            {"name": "Tunde", "score": 88},
        ])
        slides = json.dumps({"slides": [
            {"title": "Introduction", "bullets": ["Point one", "Point two"]},
            {"title": "Conclusion", "bullets": ["Summary"]},
        ]})
        outputs = {
            'pdf': _generate_file_bytes('pdf', 'Test title', '# Heading\nBody'),
            'docx': _generate_file_bytes('docx', 'Test title', '# Heading\nBody'),
            'xlsx': _generate_file_bytes('xlsx', 'Test title', table),
            'pptx': _generate_file_bytes('pptx', 'Test title', slides),
            'csv': _generate_file_bytes('csv', 'Test title', table),
            'txt': _generate_file_bytes('txt', 'Test title', 'Plain text'),
            'md': _generate_file_bytes('md', 'Test title', '# Markdown'),
            'html': _generate_file_bytes('html', 'Test title', '<h1>Hello</h1><p>Safe</p>'),
            'json': _generate_file_bytes('json', 'Test title', '{"ok":true,"count":2}'),
        }
        self.assertEqual(set(outputs), {'pdf', 'docx', 'xlsx', 'pptx', 'csv', 'txt', 'md', 'html', 'json'})
        for file_bytes in outputs.values():
            self.assertGreater(len(file_bytes), 0)

        self.assertTrue(outputs['pdf'].startswith(b'%PDF-'))
        doc = Document(io.BytesIO(outputs['docx']))
        self.assertIn('Body', '\n'.join(p.text for p in doc.paragraphs))
        workbook = load_workbook(io.BytesIO(outputs['xlsx']), data_only=True)
        self.assertEqual(workbook.active['A2'].value, 'Ada')
        presentation = Presentation(io.BytesIO(outputs['pptx']))
        self.assertEqual(len(presentation.slides), 2)
        self.assertEqual(list(csv.reader(io.StringIO(outputs['csv'].decode())))[1], ['Ada', '95'])
        self.assertEqual(outputs['txt'], b'Plain text')
        self.assertEqual(outputs['md'], b'# Markdown')
        self.assertIn(b'<h1>Hello</h1>', outputs['html'])
        self.assertEqual(json.loads(outputs['json']), {"ok": True, "count": 2})

    def test_html_is_sanitised_and_spreadsheet_formulas_are_escaped(self):
        html = _generate_file_bytes('html', 'Safe <title>', '<h1>Hi</h1><script>alert(1)</script><a href="javascript:alert(1)">bad</a>')
        self.assertNotIn(b'<script', html.lower())
        self.assertNotIn(b'javascript:', html.lower())
        self.assertIn(b'&lt;title&gt;', html)

        csv_bytes = _generate_file_bytes('csv', 'Data', '[{"value":"=1+1"},{"value":"-cmd"},{"value":-5}]')
        rows = list(csv.reader(io.StringIO(csv_bytes.decode())))
        self.assertEqual(rows[1][0], "'=1+1")
        self.assertEqual(rows[2][0], "'-cmd")
        self.assertEqual(rows[3][0], '-5')

        xlsx_bytes = _generate_file_bytes('xlsx', 'Data', '[{"value":"=1+1"},{"value":-5}]')
        workbook = load_workbook(io.BytesIO(xlsx_bytes), data_only=False)
        self.assertEqual(workbook.active['A2'].value, "'=1+1")
        self.assertEqual(workbook.active['A3'].value, -5)

    def test_format_validation_and_filename_sanitisation(self):
        with self.assertRaises(HTTPException):
            _generate_file_bytes('exe', 'Bad', 'payload')
        with self.assertRaises(HTTPException):
            _generate_file_bytes('json', 'Bad', '{not json}')
        self.assertEqual(_safe_output_filename('../../Quarterly Report.xlsx', 'xlsx'), 'Quarterly_Report.xlsx')

    def test_general_endpoint_auth_and_response_contract(self):
        response = generate_file(GenerateFileRequest(format='txt', title='Notes', content='Hello', filename='../hello.txt'), 'unit-test-secret')
        self.assertTrue(response['success'])
        self.assertEqual(response['filename'], 'hello.txt')
        self.assertEqual(base64.b64decode(response['fileBase64']), b'Hello')
        with self.assertRaises(HTTPException):
            generate_file(GenerateFileRequest(format='txt', title='Notes', content='Hello'), 'wrong-key')

    def test_http_routes_expose_general_generation_and_legacy_pdf(self):
        client = TestClient(app)
        headers = {'x-api-key': 'unit-test-secret'}
        general = client.post('/pdf/generate-file', headers=headers, json={
            'format': 'txt', 'title': 'HTTP test', 'content': 'Generated through FastAPI', 'filename': 'http.txt'
        })
        self.assertEqual(general.status_code, 200)
        self.assertEqual(general.json()['filename'], 'http.txt')
        self.assertEqual(base64.b64decode(general.json()['fileBase64']), b'Generated through FastAPI')
        legacy = client.post('/pdf/generate', headers=headers, json={
            'title': 'Legacy', 'content': 'Old route still works', 'filename': 'legacy.pdf'
        })
        self.assertEqual(legacy.status_code, 200)
        self.assertTrue(base64.b64decode(legacy.json()['pdfBase64']).startswith(b'%PDF-'))
        denied = client.post('/pdf/generate-file', headers={'x-api-key': 'wrong-key'}, json={
            'format': 'txt', 'title': 'Denied', 'content': 'No access'
        })
        self.assertEqual(denied.status_code, 401)

    def test_legacy_pdf_generate_and_extract_routes_still_work(self):
        generated = generate_pdf(GenerateRequest(title='Legacy PDF', content='Legacy route remains active', filename='legacy.pdf'), 'unit-test-secret')
        self.assertTrue(generated['success'])
        self.assertTrue(base64.b64decode(generated['pdfBase64']).startswith(b'%PDF-'))
        extracted = extract_pdf(ExtractRequest(fileBase64=generated['pdfBase64'], filename='legacy.pdf'), 'unit-test-secret')
        self.assertTrue(extracted['success'])
        self.assertIn('Legacy route remains active', extracted['text'])


if __name__ == '__main__':
    unittest.main()
