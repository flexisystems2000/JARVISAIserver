'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'axios') return { create: () => ({ get: async () => ({ data: {} }), post: async () => ({ data: {} }) }), get: async () => ({ data: {} }) };
  return originalLoad.call(this, request, parent, isMain);
};
const { VercelAgent, assertDirectStaticProject } = require('../agent/vercelAgent');
const { verifyVercelUrl } = require('../agent/vercelVerifier');
Module._load = originalLoad;

test('Vercel agent refuses production deployment without a configured token', async () => {
  const agent = new VercelAgent({ token: '' });
  await assert.rejects(() => agent.deployFiles({ name: 'sample-site', files: [{ path: 'index.html', content: '<h1>Hello</h1>' }] }), /VERCEL_TOKEN/);
});

test('Vercel verifier rejects non-Vercel URLs before making a request', async () => {
  await assert.rejects(() => verifyVercelUrl('https://example.com', { token: 'test', deploymentId: 'dpl_test' }), /an unexpected Vercel deployment URL/);
});


test('direct Vercel uploads reject framework projects instead of pretending to build them', () => {
  assert.throws(() => assertDirectStaticProject([{ path: 'package.json', content: JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '^5' } }) }]), /requires a framework build/);
  assert.throws(() => assertDirectStaticProject([{ path: 'next.config.js', content: 'module.exports = {}' }]), /Framework configuration detected/);
  assert.doesNotThrow(() => assertDirectStaticProject([{ path: 'index.html', content: '<h1>Static</h1>' }, { path: 'style.css', content: 'body{}' }]));
});
