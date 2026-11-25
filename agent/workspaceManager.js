'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class WorkspaceManager {
  constructor({ root } = {}) {
    this.root = path.resolve(root || process.env.JARVIS_SANDBOX_WORKSPACE || path.join(process.cwd(), 'sandbox-workspace'));
  }
  async create(files) {
    const id = crypto.randomBytes(12).toString('hex');
    const hostPath = path.join(this.root, id);
    await fs.promises.mkdir(hostPath, { recursive: true, mode: 0o700 });
    try {
      for (const file of files) {
        const relative = String(file.path || '');
        if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')) {
          throw new Error('Unsafe project path while creating sandbox workspace.');
        }
        const target = path.resolve(hostPath, relative);
        if (!target.startsWith(hostPath + path.sep)) throw new Error('Project path escaped the sandbox workspace.');
        await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await fs.promises.writeFile(target, String(file.content ?? ''), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      }
      return { id, hostPath, containerPath: '/workspace/' + id };
    } catch (error) {
      await this.cleanup({ hostPath });
      throw error;
    }
  }
  async cleanup(workspace) {
    if (!workspace?.hostPath) return;
    const target = path.resolve(workspace.hostPath);
    if (!target.startsWith(this.root + path.sep)) throw new Error('Refusing to clean a workspace outside the sandbox root.');
    await fs.promises.rm(target, { recursive: true, force: true });
  }
}
module.exports = { WorkspaceManager };
