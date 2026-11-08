'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProjectFiles } = require('../agent/codeValidator');
const { createCodeGenerator } = require('../agent/codeGenerator');

test('website project validator requires a root index.html', () => {
  assert.throws(() => validateProjectFiles([{ path: 'style.css', content: 'body{}' }]), /index.html/);
});

test('website project validator blocks unsafe paths and credentials', () => {
  assert.throws(() => validateProjectFiles([{ path: 'index.html', content: 'ok' }, { path: '../secret.txt', content: 'no' }]), /Unsafe/);
  assert.throws(() => validateProjectFiles([{ path: 'index.html', content: 'const x = "ghp_abcdefghijklmnopqrstuvwxyz123456";' }]), /credential/);
});

test('code generator parses structured project files', async () => {
  const generator = createCodeGenerator({ askModel: async () => JSON.stringify({
    name: 'academy-site', description: 'Academy website',
    files: [{ path: 'index.html', content: '<!doctype html>' }]
  }) });
  const result = await generator.generate({ request: 'Build an academy website' });
  assert.equal(result.name, 'academy-site');
  assert.equal(result.files[0].path, 'index.html');
});


test('coding agent creates a project and reports only a verified GitHub Pages URL', async () => {
  const Module = require('node:module');
  const originalLoad = Module._load;
  const axiosStub = { get: async () => ({ status: 200 }) };
  Module._load = function(request, parent, isMain) {
    if (request === 'axios') return axiosStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  let writes = 0;
  let saved = false;
  let CodingAgent;
  try { ({ CodingAgent } = require('../agent/codingAgent')); }
  finally { Module._load = originalLoad; }
  const github = {
    createRepository: async name => ({ owner: 'academy', name, full_name: `academy/${name}`, default_branch: 'main' }),
    getRepository: async (_owner, repo) => ({ private: false, full_name: `academy/${repo}`, html_url: `https://github.com/academy/${repo}` }),
    writeFile: async () => { writes++; },
    enableGitHubPages: async () => ({ enabled: true, url: 'https://academy.github.io/sample-site/', status: 'building' })
  };
  const coding = new CodingAgent({
    github,
    askModel: async () => JSON.stringify({
      name: 'sample-site', description: 'Sample website',
      files: [{ path: 'index.html', content: '<!doctype html><title>Sample</title>' }]
    }),
    projectManager: { save: async () => { saved = true; } }
  });
  const result = await coding.createAndDeploy({ request: 'Create a clean academy landing page', approved: true });
  assert.equal(writes, 1);
  assert.equal(saved, true);
  assert.equal(result.liveUrl, 'https://academy.github.io/sample-site/');
  assert.equal(result.deploymentVerified, true);
});
