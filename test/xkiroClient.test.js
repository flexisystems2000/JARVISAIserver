'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createXKiroClient } = require('../agent/xkiroClient');

test('xKiro sends Command A Reasoning requests using the OpenAI-compatible API', async () => {
    let captured;
    const client = createXKiroClient({
        env: { XKIRO_API_KEY: 'test-key' },
        httpClient: {
            async post(url, payload, config) {
                captured = { url, payload, config };
                return { data: { choices: [{ message: { content: '{"action":"answer","response":"Hello"}' }, finish_reason: 'stop' }] } };
            }
        }
    });

    const result = await client('Return JSON', { responseFormat: 'json' });
    assert.equal(result, '{"action":"answer","response":"Hello"}');
    assert.equal(captured.url, 'https://api.xkiro.com/v1/chat/completions');
    assert.equal(captured.payload.model, 'cohere/command-a-reasoning');
    assert.deepEqual(captured.payload.response_format, { type: 'json_object' });
    assert.equal(captured.payload.reasoning_effort, 'high');
    assert.equal(captured.config.headers.Authorization, 'Bearer test-key');
});

test('xKiro fails clearly when the API key is not configured', async () => {
    let called = false;
    const client = createXKiroClient({
        env: {},
        httpClient: { async post() { called = true; } }
    });
    await assert.rejects(client('Hello'), /XKIRO_API_KEY is not configured/);
    assert.equal(called, false);
});
