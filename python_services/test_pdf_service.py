import base64
import os
import unittest

import fitz
from piper_pdf_router import _authorize, _decode_pdf, _make_pdf, _safe_filename


class PdfServiceTests(unittest.TestCase):
    def setUp(self):
        os.environ['PIPER_API_KEY'] = 'unit-test-secret'

    def test_reportlab_generation_and_pdf_extraction(self):
        pdf = _make_pdf('Test handout', '## Topic\nPython generated this PDF.\n- Item one')
        self.assertTrue(pdf.startswith(b'%PDF-'))
        with fitz.open(stream=pdf, filetype='pdf') as document:
            text = '\n'.join(page.get_text() for page in document)
        self.assertIn('Python generated this PDF.', text)
        self.assertIn('Item one', text)

    def test_base64_pdf_validation(self):
        pdf = _make_pdf('Title', 'Body')
        self.assertEqual(_decode_pdf(base64.b64encode(pdf).decode()), pdf)
        with self.assertRaises(Exception):
            _decode_pdf(base64.b64encode(b'not a pdf').decode())

    def test_service_auth_and_filename_sanitization(self):
        _authorize('unit-test-secret')
        with self.assertRaises(Exception):
            _authorize('wrong-secret')
        self.assertEqual(_safe_filename('../../notes'), 'notes.pdf')


if __name__ == '__main__':
    unittest.main()
