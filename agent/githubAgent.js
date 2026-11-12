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

  async listIssues(owner,repo,state='open') { const p=this.repo(owner,repo); const r=await this.client().get(`/repos/${p.owner}/${p.repo}/issues`,{params:{state,per_page:100}}); return r.data.map(x=>({number:x.number,title:x.title,state:x.state,html_url:x.html_url,pull_request:!!x.pull_request})); }
  async listPullRequests(owner,repo,state='open') { const p=this.repo(owner,repo); const r=await this.client().get(`/repos/${p.owner}/${p.repo}/pulls`,{params:{state,per_page:100}}); return r.data.map(x=>({number:x.number,title:x.title,state:x.state,html_url:x.html_url,head:x.head.ref,base:x.base.ref})); }
  async createPullRequest(owner,repo,title,head,base,body='') { const p=this.repo(owner,repo); return (await this.client().post(`/repos/${p.owner}/${p.repo}/pulls`,{title,head,base,body})).data; }
}
module.exports={GitHubAgent};
