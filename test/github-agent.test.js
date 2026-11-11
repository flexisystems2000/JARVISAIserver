'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'axios') return { create: () => ({}) };
  return originalLoad.call(this, request, parent, isMain);
};
const { GitHubAgent } = require('../agent/githubAgent');
Module._load = originalLoad;

test('GitHub agent safely encodes file paths and rejects traversal', () => {
  const github = new GitHubAgent({ token: 'test', owner: 'flexi' });
  assert.equal(github.safePath('src/file name.js'), 'src/file%20name.js');
  assert.throws(() => github.safePath('../secrets.env'), /Invalid GitHub repository file path/);
  assert.throws(() => github.safePath('src/../../secrets.env'), /Invalid GitHub repository file path/);
  assert.throws(() => github.safePath('src/file.js?ref=main'), /Invalid GitHub repository file path/);
});

test('GitHub agent enforces optional repository allowlist', () => {
  const old = process.env.GITHUB_ALLOWED_REPOS;
  process.env.GITHUB_ALLOWED_REPOS = 'flexi/jarvis';
  try {
    const github = new GitHubAgent({ token: 'test', owner: 'flexi' });
    assert.doesNotThrow(() => github.assertAllowedRepository('flexi', 'jarvis'));
    assert.throws(() => github.assertAllowedRepository('other', 'repo'), /outside GITHUB_ALLOWED_REPOS/);
  } finally {
    if (old === undefined) delete process.env.GITHUB_ALLOWED_REPOS;
    else process.env.GITHUB_ALLOWED_REPOS = old;
  }
});

test('GitHub agent no longer exposes a GitHub Pages publisher', () => {
 const agent = new GitHubAgent({ token: 'test-token', owner: 'flexisystems2000' });
 assert.equal(typeof agent.createAndDeployStaticWebsite, 'undefined');
});
