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

test('code generator parses structured project files', async () => {
  const generator = createCodeGenerator({ askModel: async () => JSON.stringify({
    name: 'academy-site', description: 'Academy website', files: [{ path: 'index.html', content: '<!doctype html>' }]
  }) });
  const result = await generator.generate({ request: 'Build an academy website' });
  assert.equal(result.name, 'academy-site');
  assert.equal(result.files[0].path, 'index.html');
});

test('coding agent uses the actual GitHub static publisher after approval', async () => {
  let published = null;
  let saved = null;
  const github = {
    createAndDeployStaticWebsite: async (owner, repo, description, files, approved) => {
      published = { owner, repo, description, files, approved };
      return { repository: 'academy/sample-site', pagesUrl: 'https://academy.github.io/sample-site/', pagesConfigured: true, liveVerified: false, filesPublished: ['index.html'], note: 'Awaiting Pages propagation.' };
    }
  };
  const coding = new CodingAgent({
    github,
    askModel: async () => JSON.stringify({ name: 'sample-site', description: 'Sample website', files: [{ path: 'index.html', content: '<!doctype html><title>Sample</title>' }] }),
    projectManager: { save: async record => { saved = record; } }
  });
  await assert.rejects(() => coding.createAndDeploy({ request: 'Create a clean academy landing page', repositoryName: 'sample-site' }), /approval/i);
  const result = await coding.createAndDeploy({ request: 'Create a clean academy landing page', repositoryName: 'sample-site', owner: 'academy', approved: true });
  assert.equal(published.approved, true);
  assert.equal(published.repo, 'sample-site');
  assert.equal(published.files[0].path, 'index.html');
  assert.equal(saved.repository, 'academy/sample-site');
  assert.equal(result.liveUrl, 'https://academy.github.io/sample-site/');
  assert.equal(result.deploymentVerified, false, 'configured URL must not be reported as live-verified');
});
