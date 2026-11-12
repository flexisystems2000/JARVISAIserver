'use strict';
const axios = require('axios');
const { verifyVercelUrl } = require('./vercelVerifier');

function assertDirectStaticProject(files) {
  const configs = /^(?:next|vite|nuxt|astro|svelte|remix|gatsby)\.config\./i;
  const configFile = files.find(item => configs.test(String(item.path || '').split('/').pop()));
  if (configFile) throw new Error(`Framework configuration detected in ${configFile.path}. Direct file deployment does not run framework builds; connect the repository to Vercel Git integration or deploy its build output with the Vercel CLI.`);
  const packageFile = files.find(item => String(item.path || '').toLowerCase() === 'package.json');
  if (!packageFile) return true;
  let pkg;
  try { pkg = JSON.parse(typeof packageFile.content === 'string' ? packageFile.content : Buffer.from(packageFile.contentBase64 || '', 'base64').toString('utf8')); }
  catch (_) { throw new Error('The repository package.json is not valid JSON; fix it before deployment.'); }
  const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const frameworks = ['next', 'vite', 'nuxt', '@sveltejs/kit', 'astro', '@remix-run/react', 'react-scripts', 'gatsby'];
  if (pkg.scripts?.build || frameworks.some(name => Object.prototype.hasOwnProperty.call(dependencies, name))) {
    throw new Error('This project requires a framework build. Direct Vercel file deployment only serves prebuilt static files; connect the repository to Vercel Git integration or deploy its build output with the Vercel CLI. No deployment was started.');
  }
  return true;
}
class VercelAgent {
  constructor({ token = process.env.VERCEL_TOKEN, teamId = process.env.VERCEL_TEAM_ID } = {}) { this.token = token; this.teamId = teamId; }
  client() {
    if (!this.token) throw new Error('Vercel is not configured. Add VERCEL_TOKEN to the JARVIS hosting environment.');
    return axios.create({ baseURL: 'https://api.vercel.com', timeout: 60000, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' } });
  }
  params() { return this.teamId ? { teamId: this.teamId } : {}; }
  async deployFiles({ name, files, production = true }) {
    const projectName = String(name || 'jarvis-site').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 52) || 'jarvis-site';
    if (!Array.isArray(files) || !files.length || files.length > 100) throw new Error('Provide between 1 and 100 project files for deployment.');
    assertDirectStaticProject(files);
    const clean = files.map(item => {
      const file = String(item.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
      if (!file || file.split('/').some(part => !part || part === '.' || part === '..') || (typeof item.content !== 'string' && typeof item.contentBase64 !== 'string')) throw new Error('A deployment file has an invalid path or content.');
      const data = typeof item.contentBase64 === 'string' ? item.contentBase64 : Buffer.from(item.content, 'utf8').toString('base64');
      if (Buffer.byteLength(data, 'base64') > 1_000_000) throw new Error(`Deployment file ${file} exceeds the 1 MB per-file limit.`);
      return { file, data, encoding: 'base64' };
    });
    const total = clean.reduce((sum, item) => sum + Buffer.byteLength(item.data, 'base64'), 0);
    if (total > 8 * 1024 * 1024) throw new Error('The project is too large for this direct deployment route (8 MB limit).');
    const client = this.client();
    let project;
    try { project = (await client.get(`/v9/projects/${encodeURIComponent(projectName)}`, { params: this.params() })).data; }
    catch (error) {
      if (error.response?.status !== 404) throw new Error(`Could not inspect Vercel project: ${error.response?.data?.error?.message || error.message}`);
      try { project = (await client.post('/v10/projects', { name: projectName, framework: null }, { params: this.params() })).data; }
      catch (createError) { throw new Error(`Could not create the Vercel project: ${createError.response?.data?.error?.message || createError.message}`); }
    }
    const response = await client.post('/v13/deployments', {
      name: projectName, projectId: project.id, files: clean, target: production ? 'production' : undefined,
      projectSettings: { framework: null, buildCommand: null, outputDirectory: null, installCommand: null },
      public: true
    }, { params: this.params() });
    const deployment = response.data;
    if (!deployment?.id || !deployment?.url) throw new Error('Vercel did not return a deployment ID and URL.');
    const url = `https://${deployment.url}`;
    const verification = await verifyVercelUrl(url, { token: this.token, teamId: this.teamId, deploymentId: deployment.id });
    if (!verification.verified) throw new Error(`Vercel accepted the deployment but it is not ready yet (status: ${verification.state || 'unknown'}). Check the Vercel project dashboard before sharing the URL.`);
    return { success: true, project: projectName, deploymentId: deployment.id, url, platform: 'Vercel', state: verification.state, verified: true };
  }
}
module.exports = { VercelAgent, assertDirectStaticProject };
