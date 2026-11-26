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

test('GitHub repository creation requires explicit approval and returns a safe summary', async () => {
  const agent = new GitHubAgent({ token: 'test-token' });
  const calls = [];
  agent.client = () => ({
    get: async path => { calls.push(['GET', path]); return { data: { login: 'flexisystems2000' } }; },
    post: async (path, body) => { calls.push(['POST', path, body]); return { data: { full_name: 'flexisystems2000/new-site', private: true, html_url: 'https://github.com/flexisystems2000/new-site', default_branch: 'main', extra: 'not returned' } }; }
  });
  await assert.rejects(() => agent.createRepository({ name: 'new-site' }), /Explicit approval required/);
  const result = await agent.createRepository({ name: 'new-site', approved: true });
  assert.equal(result.full_name, 'flexisystems2000/new-site');
  assert.equal(result.private, true);
  assert.equal(calls[1][1], '/user/repos');
  assert.equal(calls[1][2].private, true);
});

test('GitHub batch upload writes all files in one commit and rejects duplicate paths', async () => {
  const agent = new GitHubAgent({ token: 'test-token', owner: 'flexisystems2000' });
  const calls = [];
  const client = {
    get: async path => {
      calls.push(['GET', path]);
      if (path === '/repos/flexisystems2000/site') return { data: { full_name: 'flexisystems2000/site', permissions: { push: true }, default_branch: 'main' } };
      if (path.endsWith('/git/ref/heads/main')) return { data: { object: { sha: 'parent-sha' } } };
      if (path.endsWith('/git/commits/parent-sha')) return { data: { tree: { sha: 'base-tree' } } };
      throw new Error(`Unexpected GET ${path}`);
    },
    post: async (path, body) => {
      calls.push(['POST', path, body]);
      if (path.endsWith('/git/blobs')) return { data: { sha: `blob-${calls.filter(x => x[1]?.endsWith('/git/blobs')).length}` } };
      if (path.endsWith('/git/trees')) return { data: { sha: 'new-tree' } };
      if (path.endsWith('/git/commits')) return { data: { sha: 'new-commit', html_url: 'https://github.com/flexisystems2000/site/commit/new-commit' } };
      throw new Error(`Unexpected POST ${path}`);
    },
    patch: async (path, body) => { calls.push(['PATCH', path, body]); return { data: { ref: 'refs/heads/main' } }; }
  };
  agent.client = () => client;
  await assert.rejects(() => agent.batchWriteFiles(undefined, 'site', [{ path: 'index.html', content: 'x' }], 'Add site', 'main'), /Explicit approval required/);
  await assert.rejects(() => agent.batchWriteFiles(undefined, 'site', [{ path: 'index.html', content: 'x' }, { path: 'index.html', content: 'y' }], 'Add site', 'main', true), /Duplicate file path/);
  const result = await agent.batchWriteFiles(undefined, 'site', [{ path: 'index.html', content: '<h1>Hello</h1>' }, { path: 'assets/logo.svg', contentBase64: Buffer.from('<svg/>').toString('base64') }], 'Add website files', 'main', true);
  assert.equal(result.filesWritten, 2);
  assert.equal(result.commitSha, 'new-commit');
  assert.equal(calls.filter(x => x[0] === 'POST' && x[1].endsWith('/git/commits')).length, 1);
  assert.equal(calls.filter(x => x[0] === 'PATCH').length, 1);
});


test('GitHub write operations block common secret and environment file paths', () => {
  const agent = new GitHubAgent({ token: 'test-token', owner: 'flexisystems2000' });
  assert.throws(() => agent.assertSafeWritePath('.env'), /sensitive file paths/);
  assert.throws(() => agent.assertSafeWritePath('config/credentials.json'), /sensitive file paths/);
  assert.throws(() => agent.assertSafeWritePath('certs/private.pem'), /sensitive file paths/);
  assert.doesNotThrow(() => agent.assertSafeWritePath('src/index.js'));
});

test('pull request creation cannot bypass explicit approval', async () => {
  const github = new GitHubAgent({ token: 'test-token', owner: 'sample-owner' });
  const calls = [];
  github.client = () => ({ post: async (url, body) => { calls.push({ url, body }); return { data: { number: 7, title: 'Test PR', state: 'open', html_url: 'https://github.com/sample-owner/demo/pull/7', head: { ref: 'feature' }, base: { ref: 'main' } } }; } });
  await assert.rejects(() => github.createPullRequest('sample-owner', 'demo', 'Title', 'feature', 'main'), /Explicit approval required/i);
  assert.equal(calls.length, 0);
  const result = await github.createPullRequest('sample-owner', 'demo', 'Title', 'feature', 'main', 'Body', true);
  assert.equal(result.number, 7);
  assert.equal(calls[0].url, '/repos/sample-owner/demo/pulls');
});

test('repository archive and settings changes require approval and reject unsupported fields', async () => {
  const github = new GitHubAgent({ token: 'test-token', owner: 'sample-owner' });
  const calls = [];
  github.assertRepositoryPermission = async () => ({ full_name: 'sample-owner/demo' });
  github.client = () => ({ patch: async (url, body) => { calls.push({ url, body }); return { data: { full_name: 'sample-owner/demo', archived: !!body.archived, private: false, default_branch: 'main', html_url: 'https://github.com/sample-owner/demo' } }; } });
  await assert.rejects(() => github.archiveRepository('sample-owner', 'demo', true), /approval required/i);
  await assert.rejects(() => github.updateRepository('sample-owner', 'demo', { unexpected: true }, true), /unsupported fields/i);
  assert.equal(calls.length, 0);
  const result = await github.archiveRepository('sample-owner', 'demo', true, true);
  assert.equal(result.archived, true);
});

test('GitHub repository search passes bounded pagination', async () => {
  const github = new GitHubAgent({ token: 'test-token', owner: 'sample-owner' });
  let call;
  github.client = () => ({ get: async (url, config) => { call = { url, params: config.params }; return { data: { total_count: 0, items: [] } }; } });
  const result = await github.searchRepositories('jarvis', 15, 2);
  assert.equal(result.totalCount, 0);
  assert.equal(call.url, '/search/repositories');
  assert.deepEqual(call.params, { q: 'jarvis', per_page: 15, page: 2, sort: 'updated' });
});

test('release and tag creation require explicit approval', async () => {
  const github = new GitHubAgent({ token: 'test-token', owner: 'sample-owner' });
  let calls = 0;
  github.client = () => ({ post: async () => { calls++; return { status: 201, data: {} }; } });
  await assert.rejects(() => github.createRelease('sample-owner', 'demo', 'v1', 'Release'), /approval required/i);
  await assert.rejects(() => github.createTag('sample-owner', 'demo', 'v1', 'a'.repeat(40), 'Release tag'), /approval required/i);
  assert.equal(calls, 0);
});
