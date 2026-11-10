'use strict';
const { createCodeGenerator } = require('./codeGenerator');
const { validateProjectFiles } = require('./codeValidator');
const { ProjectManager } = require('./projectManager');

/**
 * End-to-end static website workflow. Code generation happens only after the
 * tool registry has obtained explicit approval. Publishing is delegated to
 * GitHubAgent's implemented createAndDeployStaticWebsite method; this agent
 * deliberately does not depend on speculative createRepository/Pages APIs.
 */
class CodingAgent {
  constructor({ github, askModel, projectManager } = {}) {
    if (!github || typeof github.createAndDeployStaticWebsite !== 'function') {
      throw new Error('CodingAgent requires a compatible GitHubAgent publisher.');
    }
    if (typeof askModel !== 'function') throw new Error('CodingAgent requires an AI model adapter.');
    this.github = github;
    this.generator = createCodeGenerator({ askModel });
    this.projects = projectManager || new ProjectManager();
  }

  async createAndDeploy({ request, repositoryName, owner, description, approved = false } = {}) {
    if (!approved) throw new Error('Owner/system-admin approval is required before creating a public repository or deploying a website.');
    const brief = String(request || '').trim();
    if (brief.length < 8 || brief.length > 6000) throw new Error('Website request must contain between 8 and 6,000 characters.');
    if (!this.github.token) throw new Error('GitHub is not connected. Configure GITHUB_TOKEN in the JARVIS hosting environment before creating a website.');

    const generated = await this.generator.generate({ request: brief, projectName: repositoryName });
    const files = validateProjectFiles(generated.files, { maxFiles: 30, maxFileBytes: 50000, maxTotalBytes: 450000 });
    const name = String(repositoryName || generated.name || 'jarvis-website')
      .toLowerCase().replace(/[^a-z0-9_.-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'jarvis-website';
    if (!/^[a-z0-9_.-]{1,100}$/i.test(name)) throw new Error('The requested GitHub repository name is invalid.');

    const publication = await this.github.createAndDeployStaticWebsite(
      owner, name, String(description || generated.description || 'Website created by JARVIS').slice(0, 350), files, true
    );
    const record = {
      name,
      description: String(description || generated.description || '').slice(0, 350),
      owner: String(publication.repository || '').split('/')[0] || owner || '',
      repository: publication.repository,
      files: files.map(file => file.path),
      createdAt: new Date().toISOString()
    };
    let projectRecordSaved = true;
    try { await this.projects.save(record); }
    catch (_) { projectRecordSaved = false; }
    return {
      ...record,
      projectRecordSaved,
      repositoryUrl: publication.repository ? `https://github.com/${publication.repository}` : null,
      liveUrl: publication.pagesUrl,
      deploymentVerified: publication.liveVerified === true,
      deploymentStatus: publication.pagesConfigured ? 'configured' : 'unknown',
      verification: publication.liveVerified === true
        ? { verified: true, url: publication.pagesUrl }
        : { verified: false, url: publication.pagesUrl, note: publication.note || 'GitHub Pages is configured; initial publication may take several minutes.' },
      filesPublished: publication.filesPublished || files.map(file => file.path),
      platform: 'GitHub Pages (static website)',
      nextStep: publication.liveVerified === true ? 'Open the live URL to review the website.' : 'Allow GitHub Pages a few minutes to publish, then open the live URL.'
    };
  }
}
module.exports = { CodingAgent };
