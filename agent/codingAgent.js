'use strict';
const { createCodeGenerator } = require('./codeGenerator');
const { validateProjectFiles } = require('./codeValidator');
const { ProjectManager } = require('./projectManager');
const { DeploymentAgent } = require('./deploymentAgent');
const { runSandboxed } = require('./shellAgent');
const { WorkspaceManager } = require('./workspaceManager');
class CodingAgent {
  constructor({ vercel, askModel, projectManager, sandboxRunner = runSandboxed, workspaceManager } = {}) {
    if (!vercel || typeof askModel !== 'function') throw new Error('CodingAgent requires VercelAgent and AI model adapter.');
    this.vercel = vercel;
    this.generator = createCodeGenerator({ askModel });
    this.projects = projectManager || new ProjectManager();
    this.deployment = new DeploymentAgent({ vercel });
    this.sandboxRunner = sandboxRunner;
    this.workspaces = workspaceManager || new WorkspaceManager();
  }
  async checkInSandbox(files) {
    const candidates = files.filter(file => /\.(?:js|cjs|mjs|py)$/i.test(file.path) && /^[A-Za-z0-9_./-]+$/.test(file.path));
    if (!candidates.length) return { status: 'not_applicable', checks: [], message: 'No JavaScript or Python source files were available for syntax checks.' };
    let workspace;
    try {
      workspace = await this.workspaces.create(files);
      const checks = [];
      for (const file of candidates) {
        const isPython = /\.py$/i.test(file.path);
        const command = isPython ? 'python3 -m py_compile "' + file.path + '"' : 'node --check "' + file.path + '"';
        const result = await this.sandboxRunner(command, {
          cwd: workspace.containerPath,
          timeoutMs: 20000,
          image: isPython ? 'python:3.12-alpine' : 'node:20-alpine',
          maxOutput: 12000
        });
        checks.push({ file: file.path, runtime: isPython ? 'Python' : 'Node.js', exitCode: result.exitCode, timedOut: !!result.timedOut, stderr: String(result.stderr || '').slice(0, 3000) });
        if (result.timedOut || result.exitCode !== 0) {
          return { status: 'failed', checks, message: 'Sandbox syntax check failed for ' + file.path + '.' };
        }
      }
      return { status: 'passed', checks, message: 'All supported JavaScript and Python syntax checks passed in disposable containers.' };
    } catch (error) {
      return { status: 'unavailable', checks: [], message: String(error.message || error).slice(0, 500) };
    } finally {
      if (workspace) await this.workspaces.cleanup(workspace).catch(() => {});
    }
  }
  async createProject({ request, projectName }) {
    let currentRequest = String(request || '');
    let generated;
    let files;
    let sandbox = { status: 'not_run', checks: [], message: 'Sandbox check not run.' };
    for (let attempt = 0; attempt < 2; attempt++) {
      generated = await this.generator.generate({ request: currentRequest, projectName });
      files = validateProjectFiles(generated.files, { maxFiles: 100, maxFileBytes: 1000000, maxTotalBytes: 8000000, requireIndexHtml: false });
      sandbox = await this.checkInSandbox(files);
      if (sandbox.status !== 'failed' || attempt === 1) break;
      currentRequest += '\n\nCORRECTION REQUIRED: The disposable syntax-check sandbox reported these errors. Fix the affected source files and return the complete corrected project: ' + JSON.stringify(sandbox.checks);
    }
    const name = String(projectName || generated.name || 'jarvis-project').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 52) || 'jarvis-project';
    const status = sandbox.status === 'failed' ? 'generated_with_errors' : sandbox.status === 'unavailable' ? 'generated_unverified' : 'generated';
    const record = { name, description: generated.description, projectType: generated.projectType || 'software', files, fileCount: files.length, sandbox, createdAt: new Date().toISOString(), status };
    const savedPath = await this.projects.save(record);
    return { name, description: generated.description, projectType: record.projectType, files: files.map(file => file.path), projectFiles: files, fileCount: files.length, savedPath, sandbox, status };
  }
  async createAndDeploy({ request, projectName, approved = false }) {
    if (!approved) throw new Error('Explicit approval is required before deploying a production website.');
    const generated = await this.generator.generate({ request, projectName });
    const files = validateProjectFiles(generated.files, { maxFiles: 100, maxFileBytes: 1000000, maxTotalBytes: 8000000, requireIndexHtml: true });
    const name = String(projectName || generated.name || 'jarvis-website').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 52) || 'jarvis-website';
    const deployment = await this.deployment.publish({ name, files, approved: true });
    const record = { name, description: generated.description, files: files.map(x => x.path), deploymentUrl: deployment.url, createdAt: new Date().toISOString() };
    await this.projects.save(record);
    return { ...record, liveUrl: deployment.url, deploymentVerified: deployment.verified, deploymentStatus: deployment.state };
  }
}
module.exports = { CodingAgent };
