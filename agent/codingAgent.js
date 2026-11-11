'use strict';
const { createCodeGenerator } = require('./codeGenerator');
const { validateProjectFiles } = require('./codeValidator');
const { ProjectManager } = require('./projectManager');
const { DeploymentAgent } = require('./deploymentAgent');
class CodingAgent {
  constructor({ vercel, askModel, projectManager } = {}) {
    if (!vercel || typeof askModel !== 'function') throw new Error('CodingAgent requires VercelAgent and AI model adapter.');
    this.vercel = vercel;
    this.generator = createCodeGenerator({ askModel });
    this.projects = projectManager || new ProjectManager();
    this.deployment = new DeploymentAgent({ vercel });
  }
  async createAndDeploy({ request, projectName, approved = false }) {
    if (!approved) throw new Error('Explicit approval is required before deploying a production website.');
    const generated = await this.generator.generate({ request, projectName });
    const files = validateProjectFiles(generated.files, { maxFiles: 100, maxFileBytes: 1000000, maxTotalBytes: 8000000 });
    const name = String(projectName || generated.name || 'jarvis-website').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 52) || 'jarvis-website';
    const deployment = await this.deployment.publish({ name, files, approved: true });
    const record = { name, description: generated.description, files: files.map(x => x.path), deploymentUrl: deployment.url, createdAt: new Date().toISOString() };
    await this.projects.save(record);
    return { ...record, liveUrl: deployment.url, deploymentVerified: deployment.verified, deploymentStatus: deployment.state };
  }
}
module.exports = { CodingAgent };
