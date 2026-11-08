'use strict';
const fs = require('fs');
const path = require('path');
class ProjectManager {
  constructor({ directory } = {}) { this.directory = directory || path.join(process.cwd(), 'data', 'projects'); }
  async save(project) {
    await fs.promises.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const safe = String(project.name || 'project').toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 48) || 'project';
    const target = path.join(this.directory, `${safe}-${Date.now()}.json`);
    await fs.promises.writeFile(target, JSON.stringify(project, null, 2), { mode: 0o600, flag: 'wx' });
    return target;
  }
}
module.exports = { ProjectManager };
