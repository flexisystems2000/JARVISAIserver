'use strict';
class DeploymentAgent {
  constructor({ vercel } = {}) { this.vercel = vercel; }
  async publish({ name, files, approved = false }) {
    if (!approved) throw new Error('Explicit approval is required before publishing a production website.');
    if (!this.vercel || typeof this.vercel.deployFiles !== 'function') throw new Error('Vercel deployment is not configured. Add VERCEL_TOKEN to the hosting environment.');
    return this.vercel.deployFiles({ name, files, production: true });
  }
}
module.exports = { DeploymentAgent };
