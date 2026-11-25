'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkspaceManager } = require('../agent/workspaceManager');

test('workspace manager writes project files and removes only the task workspace', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jarvis-sandbox-'));
  const manager = new WorkspaceManager({ root });
  const workspace = await manager.create([
    { path: 'src/main.js', content: 'console.log("ok")' },
    { path: 'README.md', content: '# Demo' }
  ]);
  assert.equal(await fs.promises.readFile(path.join(workspace.hostPath, 'src/main.js'), 'utf8'), 'console.log("ok")');
  await manager.cleanup(workspace);
  await assert.rejects(() => fs.promises.access(workspace.hostPath));
  await fs.promises.rm(root, { recursive: true, force: true });
});

test('workspace manager rejects traversal and backslash paths', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jarvis-sandbox-'));
  const manager = new WorkspaceManager({ root });
  await assert.rejects(() => manager.create([{ path: '../outside.txt', content: 'no' }]), /Unsafe project path/);
  await assert.rejects(() => manager.create([{ path: 'src\\..\\outside.txt', content: 'no' }]), /Unsafe project path/);
  await fs.promises.rm(root, { recursive: true, force: true });
});
