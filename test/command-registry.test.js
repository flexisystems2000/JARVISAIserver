'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CommandRegistry } = require('../agent/commandRegistry');

test('command registry includes the quiz stop command and TTS menu command', () => {
  const registry = new CommandRegistry();
  assert.equal(registry.resolve('!quiz off').usage, '!quiz off');
  assert.equal(registry.resolve('!tts').usage, '!tts [on|off|status]');
  assert.equal(registry.resolve('!help').name, '!menu');
});

test('command registry registers and resolves generated custom commands', () => {
  const registry = new CommandRegistry([]);
  registry.register({ name: '!welcome_user', category: 'Custom Commands', usage: '!welcome_user [name]', description: 'Greets a user', execution: 'dynamic-tool', toolName: 'welcome_user' });
  assert.equal(registry.resolve('!welcome_user').toolName, 'welcome_user');
});


test('approved Command Inventor command is also registered as a WhatsApp command', async () => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const { DynamicCommandBuilder } = require('../agent/dynamicCommandBuilder');
  const { createToolRegistry } = require('../agent/toolRegistry');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-commands-'));
  const registry = createToolRegistry();
  const commands = new CommandRegistry([]);
  const builder = new DynamicCommandBuilder({ directory, registry, commandRegistry: commands });
  try {
    const result = await builder.create({
      name: 'welcome_user',
      description: 'Greet a user',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: [], additionalProperties: false },
      implementation: { operation: 'template', template: 'Welcome {{name}}' }
    }, { approved: true });
    assert.equal(result.command, '!welcome_user');
    assert.equal(commands.resolve('!welcome_user').execution, 'dynamic-tool');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
