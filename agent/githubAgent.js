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
  assertAllowedRepository(owner,repo) { const fullName=`${owner || this.owner || ''}/${repo || ''}`.toLowerCase(); const configured=String(process.env.GITHUB_ALLOWED_REPOS || '').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean); if(configured.length && !configured.includes(fullName)) throw new Error(`Repository ${fullName} is outside GITHUB_ALLOWED_REPOS.`); }
  async listRepositories() { const r=await this.client().get('/user/repos',{params:{per_page:100,sort:'updated'}}); return r.data.map(x=>({full_name:x.full_name,private:x.private,default_branch:x.default_branch,html_url:x.html_url})); }
  async getRepository(owner,repo) { const p=this.repo(owner,repo); this.assertAllowedRepository(p.owner,p.repo); return (await this.client().get(`/repos/${p.owner}/${p.repo}`)).data; }
  async assertRepositoryPermission(owner,repo,required='push') { const info=await this.getRepository(owner,repo); const granted=info.permissions || {}; if (required==='admin' ? granted.admin !== true : !(granted.push === true || granted.admin === true)) throw new Error(`The configured GitHub account (${info.full_name}) does not have ${required} permission on this repository.`); return info; }
  async getTree(owner,repo,branch) { const c=this.client(), p=this.repo(owner,repo); this.assertAllowedRepository(p.owner,p.repo); const ref=branch|| (await c.get(`/repos/${p.owner}/${p.repo}`)).data.default_branch; const r=await c.get(`/repos/${p.owner}/${p.repo}/git/trees/${encodeURIComponent(ref)}`,{params:{recursive:1}}); return r.data.tree.map(x=>({path:x.path,type:x.type,size:x.size})); }
  async readFile(owner,repo,filePath,ref) { const c=this.client(),p=this.repo(owner,repo); this.assertAllowedRepository(p.owner,p.repo); const safePath=this.safePath(filePath); const r=await c.get(`/repos/${p.owner}/${p.repo}/contents/${safePath}`,{params:ref?{ref}:undefined}); if(r.data.encoding!=='base64') throw new Error('Unsupported GitHub content encoding'); return Buffer.from(r.data.content,'base64').toString('utf8'); }
  async searchCode(query) { const r=await this.client().get('/search/code',{params:{q:query,per_page:30}}); return r.data.items.map(x=>({name:x.name,path:x.path,repository:x.repository.full_name,html_url:x.html_url})); }
  async createBranch(owner,repo,branch,from) { const c=this.client(),p=this.repo(owner,repo); const base=await c.get(`/repos/${p.owner}/${p.repo}/git/ref/heads/${encodeURIComponent(from||'main')}`); return (await c.post(`/repos/${p.owner}/${p.repo}/git/refs`,{ref:`refs/heads/${branch}`,sha:base.data.object.sha})).data; }
  async writeFile(owner,repo,filePath,content,message,branch,approved=false) { if(!approved) throw new Error('Approval required before writing repository files'); await this.assertRepositoryPermission(owner,repo,'push'); const c=this.client(),p=this.repo(owner,repo),safePath=this.safePath(filePath); let sha; try{sha=(await c.get(`/repos/${p.owner}/${p.repo}/contents/${safePath}`,{params:branch?{ref:branch}:undefined})).data.sha;}catch(e){if(e.response?.status!==404)throw e;} return (await c.put(`/repos/${p.owner}/${p.repo}/contents/${safePath}`,{message,content:Buffer.from(String(content)).toString('base64'),branch,...(sha?{sha}:{})})).data; }
  async deleteFile(owner,repo,filePath,message,branch,approved=false) { if(!approved) throw new Error('Explicit approval required before deleting repository files'); await this.assertRepositoryPermission(owner,repo,'admin'); const c=this.client(),p=this.repo(owner,repo),safePath=this.safePath(filePath); const item=(await c.get(`/repos/${p.owner}/${p.repo}/contents/${safePath}`,{params:branch?{ref:branch}:undefined})).data; return (await c.delete(`/repos/${p.owner}/${p.repo}/contents/${safePath}`,{data:{message,sha:item.sha,branch}})).data; }
  async createAndDeployStaticWebsite(owner,repo,description,files,approved=false) {
    if (!approved) throw new Error('Explicit approval is required before creating or publishing a GitHub website.');
    const p=this.repo(owner,repo);
    this.assertAllowedRepository(p.owner,p.repo);
    if (!Array.isArray(files) || files.length < 1 || files.length > 30) throw new Error('Provide between 1 and 30 website files.');
    const normalized=files.map(file=>{
      if (!file || typeof file.path!=='string' || typeof file.content!=='string') throw new Error('Each website file needs a path and text content.');
      if (Buffer.byteLength(file.content,'utf8') > 50000) throw new Error(`Website file ${file.path} exceeds 50 KB.`);
      return {path:this.safePath(file.path),content:file.content};
    });
    if (!normalized.some(file=>file.path==='index.html')) throw new Error('A static website must include index.html at the repository root.');
    const c=this.client();
    let repository;
    try {
      repository=(await c.get(`/repos/${p.owner}/${p.repo}`)).data;
      const permissions=repository.permissions||{};
      if (permissions.admin!==true) throw new Error(`The configured GitHub account does not have administrator permission on ${repository.full_name}.`);
    } catch (error) {
      if (error.response?.status!==404) throw error;
      const identity=(await c.get('/user')).data;
      const createPath=String(identity.login).toLowerCase()===p.owner.toLowerCase() ? '/user/repos' : `/orgs/${p.owner}/repos`;
      repository=(await c.post(createPath,{name:p.repo,description:String(description||'Website created by JARVIS').slice(0,350),private:false,auto_init:true})).data;
    }
    const branch=repository.default_branch||'main';
    for (const file of normalized) {
      const safePath=file.path;
      let sha;
      try { sha=(await c.get(`/repos/${p.owner}/${p.repo}/contents/${safePath}`,{params:{ref:branch}})).data.sha; }
      catch(error) { if(error.response?.status!==404) throw error; }
      await c.put(`/repos/${p.owner}/${p.repo}/contents/${safePath}`,{
        message:`JARVIS website: publish ${safePath}`,
        content:Buffer.from(file.content,'utf8').toString('base64'),branch,
        ...(sha?{sha}:{})
      });
    }
    let pages;
    try {
      pages=(await c.post(`/repos/${p.owner}/${p.repo}/pages`,{source:{branch,path:'/'}})).data;
    } catch(error) {
      if (![409,422].includes(error.response?.status)) throw error;
      pages=(await c.get(`/repos/${p.owner}/${p.repo}/pages`)).data;
    }
    const url=pages.html_url||`https://${p.owner}.github.io/${p.repo}/`;
    return {repository:repository.full_name,branch,filesPublished:normalized.map(x=>x.path),pagesUrl:url,pagesConfigured:true,liveVerified:false,note:'GitHub Pages is configured. First publication or DNS/CDN propagation can take several minutes; open the URL to confirm it is live.'};
  }
  async listIssues(owner,repo,state='open') { const p=this.repo(owner,repo); const r=await this.client().get(`/repos/${p.owner}/${p.repo}/issues`,{params:{state,per_page:100}}); return r.data.map(x=>({number:x.number,title:x.title,state:x.state,html_url:x.html_url,pull_request:!!x.pull_request})); }
  async listPullRequests(owner,repo,state='open') { const p=this.repo(owner,repo); const r=await this.client().get(`/repos/${p.owner}/${p.repo}/pulls`,{params:{state,per_page:100}}); return r.data.map(x=>({number:x.number,title:x.title,state:x.state,html_url:x.html_url,head:x.head.ref,base:x.base.ref})); }
  async createPullRequest(owner,repo,title,head,base,body='') { const p=this.repo(owner,repo); return (await this.client().post(`/repos/${p.owner}/${p.repo}/pulls`,{title,head,base,body})).data; }
}
module.exports={GitHubAgent};
