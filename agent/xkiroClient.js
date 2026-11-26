'use strict';

const DEFAULT_BASE_URL = 'https://api.xkiro.com/v1';
const DEFAULT_MODEL = 'cohere/command-a-reasoning';

function extractText(response) {
    const content = response?.data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
        return content.map(part => typeof part === 'string' ? part : String(part?.text || '')).join('').trim();
    }
    return '';
}

function createXKiroClient({ httpClient = require('axios'), env = process.env } = {}) {
    if (!httpClient || typeof httpClient.post !== 'function') {
        throw new Error('xKiro client requires an HTTP client with a post method.');
    }

    return async function askInternalModel(prompt, options = {}) {
        const apiKey = String(env.XKIRO_API_KEY || '').trim();
        if (!apiKey) throw new Error('XKIRO_API_KEY is not configured.');

        const baseUrl = String(env.XKIRO_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
        const model = String(env.XKIRO_MODEL || DEFAULT_MODEL).trim();
        const payload = {
            model,
            messages: [{ role: 'user', content: String(prompt || '') }],
            max_tokens: Math.min(32768, Math.max(256, Number(options.maxTokens) || 4096))
        };

        if (options.responseFormat === 'json') {
            payload.response_format = { type: 'json_object' };
            payload.reasoning_effort = options.reasoningEffort || 'high';
        } else if (options.reasoningEffort) {
            payload.reasoning_effort = options.reasoningEffort;
        }

        const response = await httpClient.post(`${baseUrl}/chat/completions`, payload, {
            timeout: Math.max(10000, Number(env.XKIRO_TIMEOUT_MS) || 70000),
            maxContentLength: 12 * 1024 * 1024,
            maxBodyLength: 12 * 1024 * 1024,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
            }
        });

        const text = extractText(response);
        if (!text) {
            const finishReason = response?.data?.choices?.[0]?.finish_reason || 'unknown';
            throw new Error(`xKiro returned an empty assistant response (finish reason: ${finishReason}).`);
        }
        return text;
    };
}

module.exports = { createXKiroClient, extractText, DEFAULT_BASE_URL, DEFAULT_MODEL };
