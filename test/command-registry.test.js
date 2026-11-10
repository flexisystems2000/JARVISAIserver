'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { COMMANDS, WHATSAPP_ONLY_COMMANDS, REMOVED_COMMANDS } = require('../agent/commandRegistry');

test('the Agent exposes exactly 57 unique command forms', () => {
  assert.equal(COMMANDS.length, 57);
  assert.equal(new Set(COMMANDS.map(x => x.id)).size, 57);
  assert.equal(new Set(COMMANDS.map(x => `whatsapp_${x.id}`)).size, 57);
  for (const item of COMMANDS) {
    assert.ok(item.command.startsWith('!'));
    assert.ok(item.description.length > 10);
  }
});

test('two dictionary commands are removed and nine group commands remain WhatsApp-only', () => {
  const commands = new Set(COMMANDS.map(x => x.command));
  assert.deepEqual(REMOVED_COMMANDS, ['!define', '!dictionary']);
  for (const command of REMOVED_COMMANDS) assert.equal(commands.has(command), false);
  assert.deepEqual(WHATSAPP_ONLY_COMMANDS, ['!add','!kick','!remove all','!ban','!unban','!promote','!mute','!unmute','!reset']);
  for (const command of WHATSAPP_ONLY_COMMANDS) assert.equal(commands.has(command), false, `${command} must not be an Agent tool`);
});

test('all remaining command families and operational subcommands are present', () => {
  const commands = new Set(COMMANDS.map(x => x.command));
  for (const command of ['!ai','!createfile','!quiz','!quiz off','!stopquiz','!command list','!command create','!remind','!cancelreminder','!yt search','!yt video','!yt audio','!yt download','!approvals','!approve','!reject','!settimetable','!menu','!help']) {
    assert.ok(commands.has(command), `Missing ${command}`);
  }
});

test('all 57 command forms register callable Agent tools exactly once', async () => {
  const { createToolRegistry } = require('../agent/toolRegistry');
  const { registerWhatsAppCommandTools } = require('../agent/commandRegistry');
  const registry = createToolRegistry();
  registerWhatsAppCommandTools(registry, async entry => ({ dispatched: entry.command }));
  const commandTools = registry.describe().filter(tool => tool.name.startsWith('whatsapp_'));
  assert.equal(commandTools.length, 57);
  for (const entry of COMMANDS) {
    const tool = registry.tools.get(`whatsapp_${entry.id}`);
    assert.equal(typeof tool.handler, 'function');
    assert.equal(tool.permissions[0], 'user');
  }
});

test('the WhatsApp menu documents every Agent-visible and WhatsApp-only command form', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const start = source.indexOf('const menuText = `');
  const end = source.indexOf('`;\n\n    return sock.sendMessage', start);
  assert.ok(start >= 0 && end > start, 'menu template must exist');
  const menu = source.slice(start, end);
  for (const entry of COMMANDS) assert.ok(menu.includes(entry.command), `!menu is missing ${entry.command}`);
  for (const command of WHATSAPP_ONLY_COMMANDS) assert.ok(menu.includes(command), `!menu is missing ${command}`);
  for (const command of REMOVED_COMMANDS) assert.equal(menu.includes(command), false, `!menu must not show ${command}`);
});
