'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProjectFiles } = require('../agent/codeValidator');
const { createCodeGenerator } = require('../agent/codeGenerator');
const { CodingAgent } = require('../agent/codingAgent');

test('website project validator requires a root index.html', () => {
  assert.throws(() => validateProjectFiles([{ path: 'style.css', content: 'body{}' }]), /index.html/);
});

test('website project validator blocks unsafe paths, credentials and oversized files', () => {
  assert.throws(() => validateProjectFiles([{ path: 'index.html', content: 'ok' }, { path: '../secret.txt', content: 'no' }]), /Unsafe/);
  assert.throws(() => validateProjectFiles([{ path: 'index.html', content: 'const x = "ghp_abcdefghijklmnopqrstuvwxyz123456";' }]), /credential/);
  assert.throws(() => validateProjectFiles([{ path: 'index.html', content: 'x'.repeat(50001) }]), /too large/);
});

test('code generator parses structured project files for Vercel', async () => {
  const generator = createCodeGenerator({ askModel: async () => JSON.stringify({
    name: 'academy-site', description: 'Academy website', files: [{ path: 'index.html', content: '<!doctype html>' }]
  }) });
  const result = await generator.generate({ request: 'Build an academy website' });
  assert.equal(result.name, 'academy-site');
  assert.equal(result.files[0].path, 'index.html');
});

test('coding agent requires approval and returns the verified Vercel URL', async () => {
  let saved = null;
  const vercel = { deployFiles: async ({ name, files, production }) => ({ project: name, url: `https://${name}.vercel.app`, verified: true, state: 'READY', production, files: files.length }) };
  const coding = new CodingAgent({ vercel, askModel: async () => JSON.stringify({ name: 'sample-site', description: 'Sample website', files: [{ path: 'index.html', content: '<!doctype html><title>Sample</title>' }] }), projectManager: { save: async record => { saved = record; } } });
  await assert.rejects(() => coding.createAndDeploy({ request: 'Create a landing page', projectName: 'sample-site' }), /approval/i);
  const result = await coding.createAndDeploy({ request: 'Create a landing page', projectName: 'sample-site', approved: true });
  assert.equal(result.liveUrl, 'https://sample-site.vercel.app');
  assert.equal(result.deploymentVerified, true);
  assert.equal(saved.deploymentUrl, result.liveUrl);
});
