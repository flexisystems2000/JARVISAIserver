'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boundedPrompt, boundedSchemaPrompt, MAX_PROMPT_CHARS } = require('../agent/promptBudget');

test('boundedPrompt keeps the request and remains below the hard limit with a large catalogue', () => {
  const catalog = Array.from({ length: 39 }, (_, i) => ({
    name: `github_tool_${i + 1}`,
    description: 'A detailed tool description '.repeat(30),
    requiresApproval: i % 7 === 0
  }));
  const prompt = boundedPrompt({
    system: 'JARVIS system instructions',
    catalog: JSON.stringify(catalog),
    history: 'old conversation context '.repeat(1000),
    message: 'Create a complete school website with HTML, CSS and JavaScript.'
  });
  assert.ok(prompt.length <= MAX_PROMPT_CHARS);
  assert.match(prompt, /Create a complete school website/);
  assert.match(prompt, /github_tool_1/);
  assert.match(prompt, /github_tool_39/);
});

test('boundedPrompt trims long history before losing the current request', () => {
  const prompt = boundedPrompt({
    system: 'system',
    catalog: '[]',
    history: 'previous message '.repeat(3000),
    message: 'Please create the PDF now.'
  });
  assert.ok(prompt.length <= MAX_PROMPT_CHARS);
  assert.match(prompt, /Please create the PDF now\./);
});

test('boundedSchemaPrompt retains every selected schema and fits the hard limit', () => {
  const schemas = Array.from({ length: 4 }, (_, i) => ({
    name: `tool_${i}`,
    description: 'Tool description '.repeat(20),
    parameters: {
      type: 'object',
      required: ['repository', 'path'],
      properties: {
        repository: { type: 'string' },
        path: { type: 'string' }
      }
    }
  }));
  const prompt = boundedSchemaPrompt({
    system: 'system',
    schemas,
    message: 'Update the requested repository file.',
    instruction: 'Return one validated tool JSON object.'
  });
  assert.ok(prompt.length <= MAX_PROMPT_CHARS);
  for (let i = 0; i < schemas.length; i++) assert.match(prompt, new RegExp(`tool_${i}`));
});

test('boundedSchemaPrompt fails clearly rather than silently dropping a required schema', () => {
  const schemas = [{
    name: 'large_tool',
    description: 'Large schema',
    parameters: { type: 'object', properties: { payload: { type: 'string', enum: Array.from({ length: 15000 }, (_, i) => `value_${i}`) } } }
  }];
  assert.throws(
    () => boundedSchemaPrompt({ system: 'system', schemas, message: 'Run this tool.' }),
    /schemas are too large/
  );
});
