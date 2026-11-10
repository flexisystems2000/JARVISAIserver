'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CREATE_FILE_FORMATS,
  validateCreateFileRequest,
  inferCreateFileFormat,
  extractCreateFileName,
  deriveCreateFileTitle,
  buildCreateFilePrompt
} = require('../fileGenerator');

test('file generator supports the complete format allowlist', () => {
  assert.deepEqual(Object.keys(CREATE_FILE_FORMATS).sort(), ['csv','docx','html','json','md','pdf','pptx','txt','xlsx'].sort());
});

test('file format inference honours extensions and natural descriptions', () => {
  assert.equal(inferCreateFileFormat('Create notes as report.docx'), 'docx');
  assert.equal(inferCreateFileFormat('Make an Excel spreadsheet about attendance'), 'xlsx');
  assert.equal(inferCreateFileFormat('Prepare a PowerPoint presentation about AI'), 'pptx');
  assert.equal(inferCreateFileFormat('Export a CSV of learners'), 'csv');
  assert.equal(inferCreateFileFormat('Create a Markdown guide'), 'md');
  assert.equal(inferCreateFileFormat('Create a plain text file'), 'txt');
  assert.equal(inferCreateFileFormat('Build an HTML web page'), 'html');
  assert.equal(inferCreateFileFormat('Return this as JSON'), 'json');
  assert.equal(inferCreateFileFormat('Create a document about algebra'), 'pdf');
});

test('file names and titles are extracted without path traversal', () => {
  assert.equal(extractCreateFileName('Create a report and save as Final Report.docx'), 'Final Report.docx');
  assert.equal(extractCreateFileName('Create budget.xlsx'), 'budget.xlsx');
  assert.equal(deriveCreateFileTitle('Create an Excel spreadsheet about school attendance'), 'school attendance');
});

test('format-specific AI prompts require machine-readable structures when needed', () => {
  assert.match(buildCreateFilePrompt('Make a spreadsheet', 'xlsx', 'Spreadsheet'), /valid JSON tabular data/);
  assert.match(buildCreateFilePrompt('Make slides', 'pptx', 'Slides'), /"slides"/);
  assert.match(buildCreateFilePrompt('Create HTML', 'html', 'Page'), /sanitise the markup/);
  assert.match(buildCreateFilePrompt('Create JSON', 'json', 'Data'), /only valid JSON/);
});

test('explicit unsupported filename extensions are rejected instead of silently defaulting to PDF', () => {
  assert.throws(() => validateCreateFileRequest('Create a report and save as report.exe'), /Unsupported file format: \.exe/);
  assert.equal(validateCreateFileRequest('Create a report and save as report.pdf'), true);
});
