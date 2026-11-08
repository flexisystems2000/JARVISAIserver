'use strict';
const { createCodeGenerator } = require('./codeGenerator');
const { validateProjectFiles } = require('./codeValidator');
const { ProjectManager } = require('./projectManager');
const { DeploymentAgent } = require('./deploymentAgent');
class CodingAgent {
  constructor({ github, askModel, projectManager } = {}) {
    if (!github || typeof askModel !== 'function') throw new Error('CodingAgent requires GitHubAgent and AI model adapter.');
    this.github = github;
    this.generator = createCodeGenerator({ askModel });
    this.projects = projectManager || new ProjectManager();
    this.deployment = new DeploymentAgent({ github });
  }
  async createAndDeploy({ request, repositoryName, owner, approved = false }) {
    if (!approved) throw new Error('Owner approval is required before creating a public repository or deploying a website.');
    const generated = await this.generator.generate({ request, projectName: repositoryName });
    const files = validateProjectFiles(generated.files);
    const name = String(repositoryName || generated.name || 'jarvis-website')
      .toLowerCase().replace(/[^a-z0-9_.-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'jarvis-website';
    const repo = await this.github.createRepository(name, generated.description, false);
    const record = { name, description: generated.description, owner: repo.owner, repository: repo.full_name, files: files.map(x => x.path), createdAt: new Date().toISOString() };
    await this.projects.save(record);
    const deployment = await this.deployment.publish({ owner: repo.owner, repo: repo.name, files, branch: repo.default_branch || 'main', approved: true });
    return { ...record, repositoryUrl: deployment.repositoryUrl, liveUrl: deployment.deploymentUrl,
      deploymentVerified: deployment.deploymentVerified, deploymentStatus: deployment.pagesStatus,
      verification: deployment.verification };
  }
}
module.exports = { CodingAgent };
