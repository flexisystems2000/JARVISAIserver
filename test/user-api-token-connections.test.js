'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TOKEN_PROVIDERS } = require('../agent/userApiTokenConnections');

test('API-token registry includes common developer and cloud providers', () => {
  for (const name of ['cloudflare', 'render', 'railway', 'digitalocean', 'stripe', 'resend', 'openai', 'github', 'gitlab', 'netlify', 'supabase']) {
    assert.ok(TOKEN_PROVIDERS[name], `missing token provider: ${name}`);
  }
});

test('every token provider has a label and a validation function', () => {
  for (const [name, provider] of Object.entries(TOKEN_PROVIDERS)) {
    assert.ok(provider.label, `${name} needs a label`);
    assert.equal(typeof provider.validate, 'function', `${name} needs a validator`);
  }
});

test('API-token provider labels are unique', () => {
  const labels = Object.values(TOKEN_PROVIDERS).map(provider => provider.label);
  assert.equal(new Set(labels).size, labels.length);
});
