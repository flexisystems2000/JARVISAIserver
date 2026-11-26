'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('dashboard inline escape helper keeps newline escapes valid in generated browser JavaScript', () => {
  // The dashboard is emitted from a server-side template literal. These doubled
  // escapes are intentional: the browser must receive a valid newline matcher.
  assert.ok(indexSource.includes(String.raw` .replace(/\\n/g,'\\\\n')`.trim()));
  const emittedHelper = String.raw`function escapeJs(value) { return String(value || '').replace(/\n/g, '\\n'); }`;
  assert.doesNotThrow(() => new Function(emittedHelper));
  const escapeJs = new Function(emittedHelper + '; return escapeJs;')();
  assert.equal(escapeJs('first\nsecond'), 'first\\nsecond');
});

test('WhatsApp bot mention cleanup preserves the whitespace matcher in its template literal', () => {
  assert.ok(indexSource.includes("new RegExp(`@${escaped}(?=\\\\s|$|[.,!?])`, 'g')"));
});
