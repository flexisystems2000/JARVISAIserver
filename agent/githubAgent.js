'use strict';
const axios = require('axios');
class GitHubAgent {
  constructor({ token = process.env.GITHUB_TOKEN, owner = process.env.GITHUB_OWNER } = {}) {
    this.token=token; this.owner=owner;
  }
  client() {
    if(!this.token) throw new Error('GITHUB_TOKEN is not configured');
    return axios.create({baseURL:'https://api.github.com',timeout:20000,headers:{Authorization:`Bearer ${this.token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
  }
  repo(owner,repo) { const resolvedOwner=owner||this.owner; for (const [label,value] of [['owner',resolvedOwner],['repo',repo]]) if (typeof value!=='string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(value)) throw new Error(`Invalid GitHub ${label} name`); return {owner:resolvedOwner,repo}; }
  safePath(filePath) { if (typeof filePath!=='string' || !filePath || filePath.startsWith('/') || filePath.includes('\\') || filePath.split('/').some(part => !part || part==='.' || part==='..') || /[?#]/.test(filePath)) throw new Error('Invalid GitHub repository file path'); return filePath.split('/').map(encodeURIComponent).join('/'); }
  assertSafeWritePath(filePath) { this.safePath(filePath); if (/(^|\/)(?:\.env(?:\..*)?|\.git|id_rsa|id_ed25519|secrets?\.(?:json|ya?ml)|credentials?\.(?:json|ya?ml)|[^/]+\.(?:pem|key|p12|pfx))$/i.test(filePath)) throw new Error(`Writing sensitive file paths is blocked: ${filePath}`); }
  assertAllowedRepository(owner,repo) { const fullName=`${owner || this.owner || ''}/${repo || ''}`.toLowerCase(); const configured=String(process.env.GITHUB_ALLOWED_REPOS || '').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean); if(configured.length && !configured.includes(fullName)) throw new Error(`Repository ${fullName} is outside GITHUB_ALLOWED_REPOS.`); }
  async listRepositories() { const r=await this.client().get('/user/repos',{params:{per_page:100,sort:'updated'}}); return r.data.map(x=>({full_name:x.full_name,private:x.private,default_branch:x.default_branch,html_url:x.html_url})); }
  async getRepository(owner,repo) { const p=this.repo(owner,repo); this.assertAllowedRepository(p.owner,p.repo); return (await this.client().get(`/repos/${p.owner}/${p.repo}`)).data; }
  async downloadRepositoryArchive(owner, repo, ref) {
    const info = await this.getRepository(owner, repo);
    const branch = ref || info.default_branch;
    if (typeof branch !== 'string' || !/^[A-Za-z0-9._/-]{1,200}$/.test(branch) || branch.includes('..')) throw new Error('Invalid GitHub branch or tag.');
    const response = await this.client().get(`/repos/${info.owner.login}/${info.name}/tarball/${encodeURIComponent(branch)}`, {
      responseType: 'arraybuffer', maxContentLength: 25 * 1024 * 1024, maxBodyLength: 25 * 1024 * 1024,
      headers: { Accept: 'application/vnd.github+json' }
    });
    const buffer = Buffer.from(response.data);
    if (buffer.length < 2 || buffer[0] !== 0x1f || buffer[1] !== 0x8b) throw new Error('GitHub did not return a valid gzip repository archive.');
    return { buffer, repository: info.full_name, branch, size: buffer.length, private: !!info.private };
  }
  async assertRepositoryPermission(owner,repo,required='push') { const info=await this.getRepository(owner,repo); const granted=info.permissions || {}; if (required==='admin' ? granted.admin !== true : !(granted.push === true || granted.admin === true)) throw new Error(`The configured GitHub account (${info.full_name}) does not have ${required} permission on this repository.`); return info; }
  async getTree(owner,repo,branch) { const c=this.client(), p=this.repo(owner,repo); this.assertAllowedRepository(p.owner,p.repo); const ref=branch|| (await c.get(`/repos/${p.owner}/${p.repo}`)).data.default_branch; const r=await c.get(`/repos/${p.owner}/${p.repo}/git/trees/${encodeURIComponent(ref)}`,{params:{recursive:1}}); return r.data.tree.map(x=>({path:x.path,type:x.type,size:x.size})); }
  async readFile(owner,repo,filePath,ref) { const c=this.client(),p=this.repo(owner,repo); this.assertAllowedRepository(p.owner,p.repo); const safePath=this.safePath(filePath); const r=await c.get(`/repos/${p.owner}/${p.repo}/contents/${safePath}`,{params:ref?{ref}:undefined}); if(r.data.encoding!=='base64') throw new Error('Unsupported GitHub content encoding'); return Buffer.from(r.data.content,'base64').toString('utf8'); }
  async readFileBase64(owner,repo,filePath,ref) { const c=this.client(),p=this.repo(owner,repo); this.assertAllowedRepository(p.owner,p.repo); const safePath=this.safePath(filePath); const r=await c.get(`/repos/${p.owner}/${p.repo}/contents/${safePath}`,{params:ref?{ref}:undefined}); if(r.data.encoding!=='base64') throw new Error('Unsupported GitHub content encoding'); return String(r.data.content || '').replace(/\s+/g,''); }
  async searchCode(query) { const r=await this.client().get('/search/code',{params:{q:query,per_page:30}}); return r.data.items.map(x=>({name:x.name,path:x.path,repository:x.repository.full_name,html_url:x.html_url})); }
  async createBranch(owner,repo,branch,from) { const c=this.client(),p=this.repo(owner,repo); const base=await c.get(`/repos/${p.owner}/${p.repo}/git/ref/heads/${encodeURIComponent(from||'main')}`); return (await c.post(`/repos/${p.owner}/${p.repo}/git/refs`,{ref:`refs/heads/${branch}`,sha:base.data.object.sha})).data; }
  async writeFile(owner,repo,filePath,content,message,branch,approved=false) { if(!approved) throw new Error('Approval required before writing repository files'); await this.assertRepositoryPermission(owner,repo,'push'); this.assertSafeWritePath(filePath); const c=this.client(),p=this.repo(owner,repo),safePath=this.safePath(filePath); let sha; try{sha=(await c.get(`/repos/${p.owner}/${p.repo}/contents/${safePath}`,{params:branch?{ref:branch}:undefined})).data.sha;}catch(e){if(e.response?.status!==404)throw e;} return (await c.put(`/repos/${p.owner}/${p.repo}/contents/${safePath}`,{message,content:Buffer.from(String(content)).toString('base64'),branch,...(sha?{sha}:{})})).data; }
  async deleteFile(owner,repo,filePath,message,branch,approved=false) { if(!approved) throw new Error('Explicit approval required before deleting repository files'); await this.assertRepositoryPermission(owner,repo,'admin'); const c=this.client(),p=this.repo(owner,repo),safePath=this.safePath(filePath); const item=(await c.get(`/repos/${p.owner}/${p.repo}/contents/${safePath}`,{params:branch?{ref:branch}:undefined})).data; return (await c.delete(`/repos/${p.owner}/${p.repo}/contents/${safePath}`,{data:{message,sha:item.sha,branch}})).data; }

  async createRepository({ name, description = '', isPrivate = true, approved = false } = {}) {
    if (!approved) throw new Error('Explicit approval required before creating a GitHub repository');
    if (typeof name !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(name)) throw new Error('Invalid GitHub repository name');
    if (typeof description !== 'string' || description.length > 350) throw new Error('Repository description must be 350 characters or fewer');
    if (typeof isPrivate !== 'boolean') throw new Error('Repository visibility must be specified as a boolean');
    const c = this.client();
    const account = (await c.get('/user')).data;
    const payload = { name, description, private: isPrivate, auto_init: true };
    const response = this.owner && this.owner.toLowerCase() !== String(account.login || '').toLowerCase()
      ? await c.post(`/orgs/${encodeURIComponent(this.owner)}/repos`, payload)
      : await c.post('/user/repos', payload);
    return { full_name: response.data.full_name, private: response.data.private, html_url: response.data.html_url, default_branch: response.data.default_branch };
  }
  async batchWriteFiles(owner, repo, files, message, branch, approved = false) {
    if (!approved) throw new Error('Explicit approval required before writing repository files');
    await this.assertRepositoryPermission(owner, repo, 'push');
    if (!Array.isArray(files) || files.length < 1 || files.length > 100) throw new Error('Provide between 1 and 100 files for a batch upload');
    if (typeof message !== 'string' || !message.trim() || message.length > 200) throw new Error('A commit message of 1 to 200 characters is required');
    const seen = new Set();
    const entries = [];
    let totalBytes = 0;
    for (const item of files) {
      if (!item || typeof item.path !== 'string') throw new Error('Every uploaded file needs a path');
      this.assertSafeWritePath(item.path);
      if (seen.has(item.path)) throw new Error(`Duplicate file path in batch: ${item.path}`);
      seen.add(item.path);
      const hasText = typeof item.content === 'string';
      const hasBase64 = typeof item.contentBase64 === 'string';
      if (hasText === hasBase64) throw new Error(`File ${item.path} must provide exactly one of content or contentBase64`);
      const bytes = hasText ? Buffer.from(item.content, 'utf8') : Buffer.from(item.contentBase64, 'base64');
      if (bytes.length > 1_000_000) throw new Error(`File ${item.path} exceeds the 1 MB limit`);
      totalBytes += bytes.length;
      if (totalBytes > 8 * 1024 * 1024) throw new Error('The batch exceeds the 8 MB total upload limit');
      entries.push({ path: item.path, mode: '100644', type: 'blob', content: hasText ? item.content : undefined, base64: hasBase64 ? item.contentBase64 : undefined });
    }
    const c = this.client();
    const p = this.repo(owner, repo);
    const repository = await this.getRepository(owner, repo);
    const targetBranch = branch || repository.default_branch;
    const ref = (await c.get(`/repos/${p.owner}/${p.repo}/git/ref/heads/${encodeURIComponent(targetBranch)}`)).data;
    const parentSha = ref.object.sha;
    const parentCommit = (await c.get(`/repos/${p.owner}/${p.repo}/git/commits/${parentSha}`)).data;
    const treeEntries = [];
    for (const entry of entries) {
      const body = entry.base64 !== undefined
        ? { content: entry.base64, encoding: 'base64' }
        : { content: entry.content, encoding: 'utf-8' };
      const blob = (await c.post(`/repos/${p.owner}/${p.repo}/git/blobs`, body)).data;
      treeEntries.push({ path: entry.path, mode: entry.mode, type: entry.type, sha: blob.sha });
    }
    const tree = (await c.post(`/repos/${p.owner}/${p.repo}/git/trees`, { base_tree: parentCommit.tree.sha, tree: treeEntries })).data;
    const commit = (await c.post(`/repos/${p.owner}/${p.repo}/git/commits`, { message, tree: tree.sha, parents: [parentSha] })).data;
    await c.patch(`/repos/${p.owner}/${p.repo}/git/refs/heads/${encodeURIComponent(targetBranch)}`, { sha: commit.sha, force: false });
    return { success: true, repository: repository.full_name, branch: targetBranch, filesWritten: treeEntries.length, commitSha: commit.sha, commitUrl: commit.html_url || null };
  }


  async getPages(owner, repo) {
    const p = this.repo(owner, repo);
    try { return (await this.client().get(`/repos/${p.owner}/${p.repo}/pages`)).data; }
    catch (error) { if (error.response?.status === 404) return null; throw error; }
  }
  async enablePages(owner, repo, branch = 'main', path = '/', approved = false) {
    if (!approved) throw new Error('Explicit approval required before enabling GitHub Pages');
    await this.assertRepositoryPermission(owner, repo, 'admin');
    if (typeof branch !== 'string' || !/^[A-Za-z0-9._/-]{1,200}$/.test(branch) || branch.includes('..')) throw new Error('Invalid GitHub Pages publishing branch');
    if (!['/', '/docs'].includes(path)) throw new Error('GitHub Pages source folder must be / or /docs');
    const p = this.repo(owner, repo), c = this.client();
    const payload = { source: { branch, path } };
    const current = await this.getPages(owner, repo);
    const response = current
      ? await c.put(`/repos/${p.owner}/${p.repo}/pages`, payload)
      : await c.post(`/repos/${p.owner}/${p.repo}/pages`, payload);
    return { enabled: true, url: response.data.html_url || current?.html_url || null, status: response.data.status || current?.status || 'building', branch, path };
  }
  async listWorkflows(owner, repo) {
    const p = this.repo(owner, repo);
    const r = await this.client().get(`/repos/${p.owner}/${p.repo}/actions/workflows`, { params: { per_page: 100 } });
    return (r.data.workflows || []).map(w => ({ id: w.id, name: w.name, path: w.path, state: w.state, url: w.html_url }));
  }
  async listWorkflowRuns(owner, repo, branch, perPage = 20) {
    const p = this.repo(owner, repo);
    const params = { per_page: Math.max(1, Math.min(Number(perPage) || 20, 100)) };
    if (branch) params.branch = branch;
    const r = await this.client().get(`/repos/${p.owner}/${p.repo}/actions/runs`, { params });
    return (r.data.workflow_runs || []).map(w => ({ id: w.id, name: w.name, event: w.event, status: w.status, conclusion: w.conclusion, branch: w.head_branch, createdAt: w.created_at, url: w.html_url }));
  }
  async dispatchWorkflow(owner, repo, workflow, ref = 'main', inputs = {}, approved = false) {
    if (!approved) throw new Error('Explicit approval required before dispatching a GitHub Actions workflow');
    const p = this.repo(owner, repo);
    if (!(typeof workflow === 'string' && (/^\d+$/.test(workflow) || /^[A-Za-z0-9_.-]+\.ya?ml$/i.test(workflow)))) throw new Error('Workflow must be a numeric ID or a workflow YAML filename');
    if (typeof ref !== 'string' || !/^[A-Za-z0-9._/-]{1,200}$/.test(ref) || ref.includes('..')) throw new Error('Invalid workflow ref');
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs) || Object.keys(inputs).length > 20) throw new Error('Workflow inputs must be an object with at most 20 fields');
    await this.client().post(`/repos/${p.owner}/${p.repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, { ref, inputs });
    return { dispatched: true, repository: `${p.owner}/${p.repo}`, workflow, ref };
  }
  async createPullRequest(owner, repo, title, head, base, body = '', approved = false) {
    if (!approved) throw new Error('Explicit approval required before creating a pull request');
    const p = this.repo(owner, repo);
    for (const [label, value] of [['title', title], ['head', head], ['base', base]]) if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error(`Invalid pull request ${label}`);
    if (typeof body !== 'string' || body.length > 20000) throw new Error('Pull request body is too long');
    const r = await this.client().post(`/repos/${p.owner}/${p.repo}/pulls`, { title, head, base, body });
    return { number: r.data.number, title: r.data.title, state: r.data.state, url: r.data.html_url, head: r.data.head?.ref, base: r.data.base?.ref };
  }
  async mergePullRequest(owner, repo, number, method = 'squash', approved = false) {
    if (!approved) throw new Error('Explicit approval required before merging a pull request');
    const p = this.repo(owner, repo);
    if (!Number.isInteger(number) || number < 1) throw new Error('Invalid pull request number');
    if (!['merge', 'squash', 'rebase'].includes(method)) throw new Error('Invalid pull request merge method');
    const r = await this.client().put(`/repos/${p.owner}/${p.repo}/pulls/${number}/merge`, { merge_method: method });
    return { merged: !!r.data.merged, sha: r.data.sha || null, message: r.data.message || '' };
  }


  async rerunFailedWorkflowJobs(owner, repo, runId, approved = false) {
    if (!approved) throw new Error('Explicit approval required before rerunning GitHub Actions jobs');
    const p = this.repo(owner, repo);
    if (!Number.isInteger(runId) || runId < 1) throw new Error('Invalid GitHub Actions run ID');
    const r = await this.client().post(`/repos/${p.owner}/${p.repo}/actions/runs/${runId}/rerun-failed-jobs`);
    return { success: r.status === 201 || r.status === 202, runId };
  }

  async listIssues(owner,repo,state='open') { const p=this.repo(owner,repo); const r=await this.client().get(`/repos/${p.owner}/${p.repo}/issues`,{params:{state,per_page:100}}); return r.data.map(x=>({number:x.number,title:x.title,state:x.state,html_url:x.html_url,pull_request:!!x.pull_request})); }
  async listPullRequests(owner,repo,state='open') { const p=this.repo(owner,repo); const r=await this.client().get(`/repos/${p.owner}/${p.repo}/pulls`,{params:{state,per_page:100}}); return r.data.map(x=>({number:x.number,title:x.title,state:x.state,html_url:x.html_url,head:x.head.ref,base:x.base.ref})); }

  async searchRepositories(query, perPage = 30, page = 1) {
    if (typeof query !== 'string' || !query.trim() || query.length > 256) throw new Error('A repository search query is required.');
    const r = await this.client().get('/search/repositories', { params: { q: query, per_page: Math.max(1, Math.min(Number(perPage) || 30, 100)), page: Math.max(1, Number(page) || 1), sort: 'updated' } });
    return { totalCount: r.data.total_count, repositories: (r.data.items || []).map(x => ({ full_name: x.full_name, description: x.description, private: x.private, default_branch: x.default_branch, html_url: x.html_url, updated_at: x.updated_at })) };
  }
  async listBranches(owner, repo, perPage = 100) {
    const p = this.repo(owner, repo);
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/branches\`, { params: { per_page: Math.max(1, Math.min(Number(perPage) || 100, 100)) } });
    return r.data.map(x => ({ name: x.name, protected: x.protected, sha: x.commit?.sha }));
  }
  async getCommit(owner, repo, ref) {
    const p = this.repo(owner, repo);
    if (typeof ref !== 'string' || !ref.trim() || ref.length > 200) throw new Error('A commit SHA or ref is required.');
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/commits/\${encodeURIComponent(ref)}\`);
    return { sha: r.data.sha, message: r.data.commit?.message, author: r.data.commit?.author?.name, date: r.data.commit?.author?.date, url: r.data.html_url, parents: (r.data.parents || []).map(x => x.sha), files: (r.data.files || []).map(x => ({ filename: x.filename, status: x.status, additions: x.additions, deletions: x.deletions, changes: x.changes })) };
  }
  async compareCommits(owner, repo, base, head) {
    const p = this.repo(owner, repo);
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/compare/\${encodeURIComponent(base)}...\${encodeURIComponent(head)}\`);
    return { status: r.data.status, aheadBy: r.data.ahead_by, behindBy: r.data.behind_by, totalCommits: r.data.total_commits, commits: (r.data.commits || []).map(x => ({ sha: x.sha, message: x.commit?.message, url: x.html_url })), files: (r.data.files || []).map(x => ({ filename: x.filename, status: x.status, additions: x.additions, deletions: x.deletions, changes: x.changes })) };
  }
  async forkRepository(owner, repo, organization, approved = false) {
    if (!approved) throw new Error('Explicit approval required before forking a repository.');
    const p = this.repo(owner, repo);
    const body = organization ? { organization } : {};
    const r = await this.client().post(\`/repos/\${p.owner}/\${p.repo}/forks\`, body);
    return { full_name: r.data.full_name, html_url: r.data.html_url, default_branch: r.data.default_branch };
  }
  async updateRepository(owner, repo, updates, approved = false) {
    if (!approved) throw new Error('Explicit approval required before changing repository settings.');
    const p = this.repo(owner, repo);
    await this.assertRepositoryPermission(p.owner, p.repo, 'admin');
    const allowed = ['name','description','homepage','private','visibility','has_issues','has_projects','has_wiki','default_branch','allow_squash_merge','allow_merge_commit','allow_rebase_merge','delete_branch_on_merge'];
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new Error('Repository updates must be an object.');
    const patch = Object.fromEntries(Object.entries(updates).filter(([key]) => allowed.includes(key)));
    if (!Object.keys(patch).length || Object.keys(patch).length !== Object.keys(updates).length) throw new Error('Repository settings contain unsupported fields.');
    if (patch.name !== undefined && (typeof patch.name !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(patch.name))) throw new Error('Invalid repository name.');
    if (patch.description !== undefined && (typeof patch.description !== 'string' || patch.description.length > 350)) throw new Error('Repository description is too long.');
    if (patch.homepage !== undefined && (typeof patch.homepage !== 'string' || patch.homepage.length > 300)) throw new Error('Invalid repository homepage.');
    const r = await this.client().patch(\`/repos/\${p.owner}/\${p.repo}\`, patch);
    return { full_name: r.data.full_name, private: r.data.private, archived: r.data.archived, default_branch: r.data.default_branch, html_url: r.data.html_url };
  }
  async archiveRepository(owner, repo, archived = true, approved = false) {
    if (!approved) throw new Error('Explicit approval required before archiving or unarchiving a repository.');
    const p = this.repo(owner, repo);
    await this.assertRepositoryPermission(p.owner, p.repo, 'admin');
    const r = await this.client().patch(\`/repos/\${p.owner}/\${p.repo}\`, { archived: !!archived });
    return { full_name: r.data.full_name, archived: r.data.archived };
  }
  async createIssue(owner, repo, title, body = '', labels = [], approved = false) {
    if (!approved) throw new Error('Explicit approval required before creating an issue.');
    const p = this.repo(owner, repo);
    if (typeof title !== 'string' || !title.trim() || title.length > 256) throw new Error('Issue title is required and must be at most 256 characters.');
    if (typeof body !== 'string' || body.length > 60000) throw new Error('Issue body is too long.');
    if (!Array.isArray(labels) || labels.length > 20 || labels.some(x => typeof x !== 'string' || x.length > 50)) throw new Error('Issue labels must be an array of up to 20 label names.');
    const r = await this.client().post(\`/repos/\${p.owner}/\${p.repo}/issues\`, { title, body, labels });
    return { number: r.data.number, title: r.data.title, state: r.data.state, url: r.data.html_url };
  }
  async updateIssue(owner, repo, number, updates, approved = false) {
    if (!approved) throw new Error('Explicit approval required before updating an issue.');
    const p = this.repo(owner, repo);
    if (!Number.isInteger(number) || number < 1) throw new Error('Invalid issue number.');
    const allowed = ['title','body','state','state_reason','labels','assignees','milestone'];
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new Error('Issue updates must be an object.');
    const patch = Object.fromEntries(Object.entries(updates).filter(([key]) => allowed.includes(key)));
    if (!Object.keys(patch).length || Object.keys(patch).length !== Object.keys(updates).length) throw new Error('Issue updates contain unsupported fields.');
    if (patch.state && !['open','closed'].includes(patch.state)) throw new Error('Issue state must be open or closed.');
    const r = await this.client().patch(\`/repos/\${p.owner}/\${p.repo}/issues/\${number}\`, patch);
    return { number: r.data.number, title: r.data.title, state: r.data.state, url: r.data.html_url };
  }
  async commentIssue(owner, repo, number, body, approved = false) {
    if (!approved) throw new Error('Explicit approval required before commenting on an issue.');
    const p = this.repo(owner, repo);
    if (!Number.isInteger(number) || number < 1 || typeof body !== 'string' || !body.trim() || body.length > 60000) throw new Error('A valid issue number and comment body are required.');
    const r = await this.client().post(\`/repos/\${p.owner}/\${p.repo}/issues/\${number}/comments\`, { body });
    return { id: r.data.id, body: r.data.body, url: r.data.html_url, created_at: r.data.created_at };
  }
  async listIssueComments(owner, repo, number, perPage = 50) {
    const p = this.repo(owner, repo);
    if (!Number.isInteger(number) || number < 1) throw new Error('Invalid issue number.');
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/issues/\${number}/comments\`, { params: { per_page: Math.max(1, Math.min(Number(perPage) || 50, 100)) } });
    return r.data.map(x => ({ id: x.id, user: x.user?.login, body: x.body, created_at: x.created_at, url: x.html_url }));
  }
  async listLabels(owner, repo) {
    const p = this.repo(owner, repo);
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/labels\`, { params: { per_page: 100 } });
    return r.data.map(x => ({ name: x.name, color: x.color, description: x.description }));
  }
  async addIssueLabels(owner, repo, number, labels, approved = false) {
    if (!approved) throw new Error('Explicit approval required before changing issue labels.');
    const p = this.repo(owner, repo);
    if (!Number.isInteger(number) || number < 1 || !Array.isArray(labels) || !labels.length || labels.length > 20) throw new Error('Provide a valid issue number and 1–20 labels.');
    const r = await this.client().post(\`/repos/\${p.owner}/\${p.repo}/issues/\${number}/labels\`, { labels });
    return r.data.map(x => ({ name: x.name, color: x.color }));
  }
  async getPullRequest(owner, repo, number) {
    const p = this.repo(owner, repo);
    if (!Number.isInteger(number) || number < 1) throw new Error('Invalid pull request number.');
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/pulls/\${number}\`);
    return { number: r.data.number, title: r.data.title, body: r.data.body, state: r.data.state, draft: r.data.draft, merged: r.data.merged, mergeable: r.data.mergeable, head: r.data.head?.ref, base: r.data.base?.ref, url: r.data.html_url, user: r.data.user?.login };
  }
  async updatePullRequest(owner, repo, number, updates, approved = false) {
    if (!approved) throw new Error('Explicit approval required before updating a pull request.');
    const p = this.repo(owner, repo);
    if (!Number.isInteger(number) || number < 1 || !updates || typeof updates !== 'object' || Array.isArray(updates)) throw new Error('Invalid pull request update.');
    const allowed = ['title','body','state','base'];
    const patch = Object.fromEntries(Object.entries(updates).filter(([key]) => allowed.includes(key)));
    if (!Object.keys(patch).length || Object.keys(patch).length !== Object.keys(updates).length) throw new Error('Pull request updates contain unsupported fields.');
    if (patch.state && !['open','closed'].includes(patch.state)) throw new Error('Pull request state must be open or closed.');
    const r = await this.client().patch(\`/repos/\${p.owner}/\${p.repo}/pulls/\${number}\`, patch);
    return { number: r.data.number, title: r.data.title, state: r.data.state, url: r.data.html_url, base: r.data.base?.ref };
  }
  async reviewPullRequest(owner, repo, number, event, body = '', approved = false) {
    if (!approved) throw new Error('Explicit approval required before submitting a pull request review.');
    const p = this.repo(owner, repo);
    if (!Number.isInteger(number) || number < 1 || !['APPROVE','REQUEST_CHANGES','COMMENT'].includes(event)) throw new Error('Invalid pull request review request.');
    if (typeof body !== 'string' || body.length > 60000) throw new Error('Review body is too long.');
    const r = await this.client().post(\`/repos/\${p.owner}/\${p.repo}/pulls/\${number}/reviews\`, { event, body });
    return { id: r.data.id, state: r.data.state, submitted_at: r.data.submitted_at, url: r.data.html_url };
  }
  async requestPullRequestReviewers(owner, repo, number, reviewers = [], teamReviewers = [], approved = false) {
    if (!approved) throw new Error('Explicit approval required before requesting pull request reviewers.');
    const p = this.repo(owner, repo);
    if (!Number.isInteger(number) || number < 1 || reviewers.length + teamReviewers.length < 1 || reviewers.length + teamReviewers.length > 20) throw new Error('Provide a valid pull request number and reviewer list.');
    const r = await this.client().post(\`/repos/\${p.owner}/\${p.repo}/pulls/\${number}/requested_reviewers\`, { reviewers, team_reviewers: teamReviewers });
    return { number: r.data.number, requested_reviewers: (r.data.requested_reviewers || []).map(x => x.login), requested_teams: (r.data.requested_teams || []).map(x => x.slug) };
  }
  async listWorkflowRunJobs(owner, repo, runId) {
    const p = this.repo(owner, repo);
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/actions/runs/\${runId}/jobs\`, { params: { per_page: 100 } });
    return (r.data.jobs || []).map(x => ({ id: x.id, name: x.name, status: x.status, conclusion: x.conclusion, started_at: x.started_at, completed_at: x.completed_at, url: x.html_url, steps: (x.steps || []).map(s => ({ name: s.name, status: s.status, conclusion: s.conclusion, number: s.number })) }));
  }
  async getWorkflowJobLogs(owner, repo, jobId) {
    const p = this.repo(owner, repo);
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/actions/jobs/\${jobId}/logs\`, { responseType: 'text', maxContentLength: 2 * 1024 * 1024 });
    return String(r.data || '').slice(0, 100000);
  }
  async cancelWorkflowRun(owner, repo, runId, approved = false) {
    if (!approved) throw new Error('Explicit approval required before cancelling a workflow run.');
    const p = this.repo(owner, repo);
    const r = await this.client().post(\`/repos/\${p.owner}/\${p.repo}/actions/runs/\${runId}/cancel\`);
    return { cancelled: r.status === 202 || r.status === 200, runId };
  }
  async rerunWorkflowJob(owner, repo, jobId, approved = false) {
    if (!approved) throw new Error('Explicit approval required before rerunning a workflow job.');
    const p = this.repo(owner, repo);
    const r = await this.client().post(\`/repos/\${p.owner}/\${p.repo}/actions/jobs/\${jobId}/rerun\`);
    return { rerun: r.status === 201 || r.status === 202, jobId };
  }
  async listWorkflowArtifacts(owner, repo, runId) {
    const p = this.repo(owner, repo);
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/actions/runs/\${runId}/artifacts\`, { params: { per_page: 100 } });
    return (r.data.artifacts || []).map(x => ({ id: x.id, name: x.name, size_in_bytes: x.size_in_bytes, expired: x.expired, expires_at: x.expires_at, url: x.archive_download_url }));
  }
  async downloadWorkflowArtifact(owner, repo, artifactId) {
    const p = this.repo(owner, repo);
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/actions/artifacts/\${artifactId}/zip\`, { responseType: 'arraybuffer', maxContentLength: 25 * 1024 * 1024 });
    return { buffer: Buffer.from(r.data), filename: \`github-artifact-\${artifactId}.zip\`, size: Buffer.byteLength(r.data) };
  }
  async listReleases(owner, repo, perPage = 30) {
    const p = this.repo(owner, repo);
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/releases\`, { params: { per_page: Math.max(1, Math.min(Number(perPage) || 30, 100)) } });
    return r.data.map(x => ({ id: x.id, tag_name: x.tag_name, name: x.name, draft: x.draft, prerelease: x.prerelease, published_at: x.published_at, url: x.html_url }));
  }
  async createRelease(owner, repo, tagName, name, body = '', draft = false, prerelease = false, approved = false) {
    if (!approved) throw new Error('Explicit approval required before publishing a release.');
    const p = this.repo(owner, repo);
    if (typeof tagName !== 'string' || !/^[A-Za-z0-9._/-]{1,100}$/.test(tagName) || tagName.includes('..')) throw new Error('Invalid release tag.');
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || typeof body !== 'string' || body.length > 60000) throw new Error('Invalid release details.');
    const r = await this.client().post(\`/repos/\${p.owner}/\${p.repo}/releases\`, { tag_name: tagName, name, body, draft: !!draft, prerelease: !!prerelease });
    return { id: r.data.id, tag_name: r.data.tag_name, name: r.data.name, draft: r.data.draft, prerelease: r.data.prerelease, url: r.data.html_url };
  }
  async listCollaborators(owner, repo, perPage = 100) {
    const p = this.repo(owner, repo);
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/collaborators\`, { params: { per_page: Math.max(1, Math.min(Number(perPage) || 100, 100)) } });
    return r.data.map(x => ({ login: x.login, permissions: x.permissions, role_name: x.role_name }));
  }
  async getCollaboratorPermission(owner, repo, username) {
    const p = this.repo(owner, repo);
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/collaborators/\${encodeURIComponent(username)}/permission\`);
    return { username, permission: r.data.permission, role_name: r.data.role_name, user: r.data.user?.login };
  }
  async addCollaborator(owner, repo, username, permission = 'push', approved = false) {
    if (!approved) throw new Error('Explicit approval required before inviting a repository collaborator.');
    const p = this.repo(owner, repo);
    await this.assertRepositoryPermission(p.owner, p.repo, 'admin');
    if (!/^[A-Za-z0-9-]{1,39}$/.test(username) || !['pull','triage','push','maintain','admin'].includes(permission)) throw new Error('Invalid GitHub username or permission.');
    const r = await this.client().put(\`/repos/\${p.owner}/\${p.repo}/collaborators/\${encodeURIComponent(username)}\`, { permission });
    return { invited: true, username, permission, invitation_id: r.data.id || null };
  }
  async listDependabotAlerts(owner, repo, state = 'open') {
    const p = this.repo(owner, repo);
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/dependabot/alerts\`, { params: { state, per_page: 100 } });
    return r.data.map(x => ({ number: x.number, state: x.state, dependency: x.dependency?.package?.name, manifest: x.dependency?.manifest_path, severity: x.security_advisory?.severity, summary: x.security_advisory?.summary, fixed_at: x.fixed_at, url: x.html_url }));
  }
  async listCodeScanningAlerts(owner, repo, state = 'open') {
    const p = this.repo(owner, repo);
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/code-scanning/alerts\`, { params: { state, per_page: 100 } });
    return r.data.map(x => ({ number: x.number, state: x.state, rule: x.rule?.description, severity: x.rule?.severity, tool: x.tool?.name, file: x.most_recent_instance?.location?.path, url: x.html_url }));
  }
  async getBranchProtection(owner, repo, branch) {
    const p = this.repo(owner, repo);
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/branches/\${encodeURIComponent(branch)}/protection\`);
    return r.data;
  }
  async createTag(owner, repo, tag, targetSha, message, approved = false) {
    if (!approved) throw new Error('Explicit approval required before creating a Git tag.');
    const p = this.repo(owner, repo), c = this.client();
    if (!/^[A-Za-z0-9._/-]{1,100}$/.test(tag) || tag.includes('..') || !/^[0-9a-f]{40}$/i.test(targetSha)) throw new Error('Invalid tag name or target commit SHA.');
    const annotated = await c.post(\`/repos/\${p.owner}/\${p.repo}/git/tags\`, { tag, message: String(message || tag).slice(0, 500), object: targetSha, type: 'commit' });
    const ref = await c.post(\`/repos/\${p.owner}/\${p.repo}/git/refs\`, { ref: \`refs/tags/\${tag}\`, sha: annotated.data.sha });
    return { tag, sha: annotated.data.sha, ref: ref.data.ref };
  }
  async listDeployments(owner, repo, perPage = 30) {
    const p = this.repo(owner, repo);
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/deployments\`, { params: { per_page: Math.max(1, Math.min(Number(perPage) || 30, 100)) } });
    return r.data.map(x => ({ id: x.id, ref: x.ref, environment: x.environment, task: x.task, created_at: x.created_at, creator: x.creator?.login, url: x.url }));
  }
  async listDeploymentStatuses(owner, repo, deploymentId) {
    const p = this.repo(owner, repo);
    const r = await this.client().get(\`/repos/\${p.owner}/\${p.repo}/deployments/\${deploymentId}/statuses\`, { params: { per_page: 100 } });
    return r.data.map(x => ({ id: x.id, state: x.state, description: x.description, environment: x.environment, created_at: x.created_at, target_url: x.target_url, log_url: x.log_url }));
  }

}
module.exports={GitHubAgent};
