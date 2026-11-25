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

test('generic project validation accepts Python projects without index.html', () => {
  const files = validateProjectFiles([
    { path: 'main.py', content: 'print("hello")' },
    { path: 'requirements.txt', content: 'requests==2.32.0' },
    { path: '.env.example', content: 'API_KEY=replace_me' },
    { path: 'README.md', content: '# Example' }
  ], { requireIndexHtml: false });
  assert.equal(files.length, 4);
  assert.throws(() => validateProjectFiles([{ path: 'main.py', content: 'print(1)' }]), /index.html/);
});

test('coding agent creates and stores a multi-file non-website project', async () => {
  let saved = null;
  const coding = new CodingAgent({
    vercel: { deployFiles: async () => { throw new Error('must not deploy'); } },
    askModel: async prompt => {
      assert.match(prompt, /full-stack web app/);
      assert.doesNotMatch(prompt, /STATIC website only/);
      return JSON.stringify({ name: 'python-tool', description: 'Python utility', projectType: 'python-cli', files: [
        { path: 'main.py', content: 'print("hello")' },
        { path: 'requirements.txt', content: '' },
        { path: 'README.md', content: '# Python utility' }
      ] });
    },
    projectManager: { save: async record => { saved = record; return '/tmp/project.json'; } }
  });
  const result = await coding.createProject({ request: 'Create a Python CLI utility', projectName: 'python-tool' });
  assert.equal(result.projectType, 'python-cli');
  assert.equal(result.fileCount, 3);
  assert.equal(result.projectFiles[0].path, 'main.py');
  assert.equal(saved.files.length, 3);
});

test('coding agent checks project source in a disposable task workspace and cleans it', async () => {
  let cleaned = false;
  const workspaceManager = {
    create: async () => ({ id: 'task123', containerPath: '/workspace/task123' }),
    cleanup: async () => { cleaned = true; }
  };
  const coding = new CodingAgent({
    vercel: { deployFiles: async () => { throw new Error('must not deploy'); } },
    askModel: async () => JSON.stringify({ name: 'node-tool', description: 'Node utility', projectType: 'node-cli', files: [
      { path: 'main.js', content: 'console.log("ok")' },
      { path: 'README.md', content: '# Node tool' }
    ] }),
    projectManager: { save: async () => '/tmp/project.json' },
    workspaceManager,
    sandboxRunner: async (command, options) => {
      assert.equal(command, 'node --check "main.js"');
      assert.equal(options.cwd, '/workspace/task123');
      assert.equal(options.image, 'node:20-alpine');
      return { exitCode: 0, stdout: '', stderr: '' };
    }
  });
  const result = await coding.createProject({ request: 'Create a Node.js command-line utility', projectName: 'node-tool' });
  assert.equal(result.sandbox.status, 'passed');
  assert.equal(result.status, 'generated');
  assert.equal(cleaned, true);
});

test('coding agent reports unavailable Docker sandbox without falsely claiming tests passed', async () => {
  const coding = new CodingAgent({
    vercel: { deployFiles: async () => ({}) },
    askModel: async () => JSON.stringify({ name: 'node-tool', description: 'Node utility', files: [{ path: 'main.js', content: 'console.log(1)' }] }),
    projectManager: { save: async () => '/tmp/project.json' },
    workspaceManager: { create: async () => ({ id: 'task', containerPath: '/workspace/task' }), cleanup: async () => {} },
    sandboxRunner: async () => { throw new Error('Sandbox unavailable (Docker required): daemon not reachable'); }
  });
  const result = await coding.createProject({ request: 'Create a Node.js utility' });
  assert.equal(result.sandbox.status, 'unavailable');
  assert.equal(result.status, 'generated_unverified');
});
