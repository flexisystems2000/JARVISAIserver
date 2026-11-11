'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CommandRegistry, BUILT_IN_COMMANDS } = require('../agent/commandRegistry');

test('built-in registry has unique command names and aliases', () => {
  const registry = new CommandRegistry();
  const names = BUILT_IN_COMMANDS.map(item => item.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
  assert.equal(registry.resolve('!define'), null);
  assert.equal(registry.resolve('!dictionary'), null);
  assert.equal(registry.resolve('!translate'), null);
  assert.ok(registry.resolve('!ai'));
  assert.ok(registry.resolve('!createfile'));
});

test('the menu does not advertise retired commands and describes broad file creation', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const start = source.indexOf('const menuText = `');
  const end = source.indexOf('`;\n\n    return sock.sendMessage', start);
  assert.ok(start >= 0 && end > start);
  const menu = source.slice(start, end);
  for (const retired of ['!define', '!dictionary', '!translate']) assert.equal(menu.includes(retired), false);
  assert.match(menu, /spreadsheets, presentations, code and more/i);
});
