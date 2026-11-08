'use strict';
const { verifyPublicUrl } = require('./deploymentVerifier');
class DeploymentAgent {
  constructor({ github }) { if (!github) throw new Error('Deployment agent requires GitHubAgent.'); this.github = github; }
  async publish({ owner, repo, files, branch = 'main', approved = false }) {
    if (!approved) throw new Error('Owner approval is required before publishing a public website.');
    const repository = await this.github.getRepository(owner, repo);
    if (repository.private) throw new Error('GitHub Pages deployment requires a public repository for this workflow.');
    for (const file of files) {
      await this.github.writeFile(owner, repo, file.path, file.content,
        `Add website file ${file.path}`, branch, true);
    }
    const pages = await this.github.enableGitHubPages(owner, repo, branch);
    const verification = await verifyPublicUrl(pages.url);
    return {
      repository: repository.full_name,
      repositoryUrl: repository.html_url,
      deploymentUrl: pages.url,
      pagesStatus: pages.status,
      deploymentVerified: verification.verified,
      verification
    };
  }
}
module.exports = { DeploymentAgent };
