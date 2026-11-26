'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CREATE_FILE_FORMATS, validateCreateFileRequest, inferCreateFileFormat, extractCreateFileName, deriveCreateFileTitle, buildCreateFilePrompt, isWebsiteProjectRequest, validateGeneratedFileContent } = require('../fileGenerator');

test('file generator supports document, office, data, code, vector and archive formats', () => {
  for (const format of ['pdf','docx','xlsx','pptx','csv','txt','md','html','json','xml','yaml','yml','css','js','py','php','java','cpp','sql','svg','zip','rtf','ts','tsx','jsx','c','h','cs','go','rs','rb','sh','ps1','bat','toml','ini','conf','properties','tex','mdx','jsonl']) assert.ok(CREATE_FILE_FORMATS[format], `Missing ${format}`);
});

test('file format inference honours extensions and natural descriptions', () => {
  assert.equal(inferCreateFileFormat('Create notes as report.docx'), 'docx');
  assert.equal(inferCreateFileFormat('Make an Excel spreadsheet about attendance'), 'xlsx');
  assert.equal(inferCreateFileFormat('Prepare a PowerPoint presentation about AI'), 'pptx');
  assert.equal(inferCreateFileFormat('Export a CSV of learners'), 'csv');
  assert.equal(inferCreateFileFormat('Create a Markdown guide'), 'md');
  assert.equal(inferCreateFileFormat('Create a Python script'), 'py');
  assert.equal(inferCreateFileFormat('Create a CSS file'), 'css');
  assert.equal(inferCreateFileFormat('Create a ZIP archive'), 'zip');
  assert.equal(inferCreateFileFormat('Build a complete responsive HTML CSS JavaScript website'), 'zip');
  assert.equal(inferCreateFileFormat('Create a multi-page website for my school'), 'zip');
  assert.equal(inferCreateFileFormat('Create an HTML page explaining websites'), 'html');
  assert.equal(isWebsiteProjectRequest('Build a complete responsive website'), true);
  assert.equal(inferCreateFileFormat('Create a TypeScript file'), 'ts');
  assert.equal(inferCreateFileFormat('Create an RTF document'), 'rtf');
  assert.equal(inferCreateFileFormat('Create a document about algebra'), 'pdf');
});

test('file names and titles are extracted safely', () => {
  assert.equal(extractCreateFileName('Create a report and save as Final Report.docx'), 'Final Report.docx');
  assert.equal(extractCreateFileName('Create budget.xlsx'), 'budget.xlsx');
  assert.equal(deriveCreateFileTitle('Create an Excel spreadsheet about school attendance'), 'school attendance');
});

test('format-specific prompts request valid machine-readable content', () => {
  assert.match(buildCreateFilePrompt('Make a spreadsheet', 'xlsx', 'Spreadsheet'), /valid JSON tabular data/);
  assert.match(buildCreateFilePrompt('Make slides', 'pptx', 'Slides'), /"slides"/);
  assert.match(buildCreateFilePrompt('Create HTML', 'html', 'Page'), /complete, valid standalone HTML5 document/);
  assert.match(buildCreateFilePrompt('Create JSON', 'json', 'Data'), /only valid JSON/);
  assert.match(buildCreateFilePrompt('Create a ZIP', 'zip', 'Archive'), /"files"/);
});

test('unsupported filename extensions are rejected', () => {
  assert.throws(() => validateCreateFileRequest('Create a report and save as report.exe'), /Unsupported file format: \.exe/);
  assert.equal(validateCreateFileRequest('Create a report and save as report.pdf'), true);
});

test('generated files are validated and malformed structured output is rejected', () => {
  assert.equal(validateGeneratedFileContent('{"ok":true}', 'json').content, '{\n  "ok": true\n}');
  assert.throws(() => validateGeneratedFileContent('{bad json}', 'json'), /not valid JSON/);
  assert.throws(() => validateGeneratedFileContent('not json', 'pptx'), /not valid JSON/);
  assert.throws(() => validateGeneratedFileContent('{"slides":[]}', 'pptx'), /non-empty slides array/);
  assert.throws(() => validateGeneratedFileContent('{"files":[{"path":"../escape.txt","content":"x"}]}', 'zip'), /unsafe file path/);
  assert.throws(() => validateGeneratedFileContent('{"files":[{"path":"ok.txt","content":"x"},{"path":"ok.txt","content":"y"}]}', 'zip'), /duplicate path/);
  assert.equal(validateGeneratedFileContent('{"slides":[{"title":"Intro","bullets":["One"]}]}', 'pptx').files, null);
  assert.equal(validateGeneratedFileContent('{"files":[{"path":"src/main.py","content":"print(1)"}]}', 'zip').files.length, 1);
});
