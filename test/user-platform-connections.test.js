'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PROVIDERS } = require('../agent/userPlatformConnections');

test('JARVIS exposes a broad set of user-scoped OAuth providers', () => {
  const expected = [
    'github', 'supabase', 'google', 'vercel', 'gitlab', 'netlify',
    'discord', 'notion', 'dropbox', 'figma', 'linear'
  ];
  for (const provider of expected) {
    assert.ok(PROVIDERS[provider], `missing provider: ${provider}`);
  }
  assert.ok(Object.keys(PROVIDERS).length >= expected.length);
});

test('every OAuth provider has safe HTTPS endpoints and identity verification', () => {
  for (const [key, provider] of Object.entries(PROVIDERS)) {
    assert.ok(provider.label, `${key} needs a display label`);
    assert.ok(provider.clientIdEnv, `${key} needs a client ID env name`);
    assert.ok(provider.clientSecretEnv, `${key} needs a client secret env name`);
    assert.ok(provider.authorizeUrl.startsWith('https://'), `${key} authorize URL must use HTTPS`);
    assert.ok(provider.tokenUrl.startsWith('https://'), `${key} token URL must use HTTPS`);
    assert.equal(typeof provider.identify, 'function', `${key} must verify account identity`);
    assert.ok(Array.isArray(provider.scopes), `${key} scopes must be an array`);
  }
});

test('provider names are unique and labels are human readable', () => {
  const labels = Object.values(PROVIDERS).map(provider => provider.label);
  assert.equal(new Set(labels).size, labels.length);
  for (const label of labels) assert.ok(label.length > 1);
});
