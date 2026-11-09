'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { COMMANDS } = require('../agent/commandRegistry');

test('the complete command catalog exposes all 68 command forms as unique Agent tools', () => {
  assert.equal(COMMANDS.length, 68);
  assert.equal(new Set(COMMANDS.map(x => x.id)).size, 68);
  assert.equal(new Set(COMMANDS.map(x => `whatsapp_${x.id}`)).size, 68);
  for (const item of COMMANDS) {
    assert.ok(item.command.startsWith('!'), `Invalid command: ${item.command}`);
    assert.ok(item.description.length > 10, `Missing description: ${item.command}`);
  }
});

test('all key command families and operational subcommands are present', () => {
  const commands = new Set(COMMANDS.map(x => x.command));
  for (const command of [
    '!ai', '!tts on', '!tts off', '!quiz off', '!stopquiz',
    '!command list', '!command create', '!remind', '!cancelreminder',
    '!yt search', '!yt video', '!yt audio', '!yt download',
    '!add', '!kick', '!remove all', '!ban', '!unban', '!promote',
    '!mute', '!unmute', '!reset', '!approvals', '!approve', '!reject',
    '!settimetable', '!menu', '!help'
  ]) assert.ok(commands.has(command), `Missing ${command}`);
});

test('all 68 command forms register callable Agent tools', async () => {
  const { createToolRegistry } = require('../agent/toolRegistry');
  const { registerWhatsAppCommandTools } = require('../agent/commandRegistry');
  const registry = createToolRegistry();
  registerWhatsAppCommandTools(registry, async entry => ({ dispatched: entry.command }));
  const tools = registry.describe();
  const commandTools = tools.filter(tool => tool.name.startsWith('whatsapp_'));
  assert.equal(commandTools.length, 68);
  for (const entry of COMMANDS) {
    const tool = registry.tools.get(`whatsapp_${entry.id}`);
    assert.equal(typeof tool.handler, 'function');
    assert.equal(tool.permissions[0], 'user');
  }
});
