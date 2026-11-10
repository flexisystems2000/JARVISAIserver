'use strict';
class PermissionManager {
  constructor({ ownerNumber = '', adminNumbers = [] } = {}) {
    this.ownerNumber = String(ownerNumber).replace(/\D/g,'');
    this.adminNumbers = new Set(adminNumbers.map(x => String(x).replace(/\D/g,'')));
  }
  role(actor, context = {}) {
    const number = String(actor || '').split('@')[0].replace(/\D/g,'');
    if (number && number === this.ownerNumber) return 'owner';
    if ((number && this.adminNumbers.has(number)) || context.isAdmin === true) return 'admin';
    return 'user';
  }
  async assert({ actor, required = ['user'], context = {}, tool }) {
    const role = this.role(actor, context);
    const levels = { user: 1, admin: 2, owner: 3 };
    const allowed = required.includes('public') || required.some(r => levels[role] >= (levels[r] || 99));
    if (!allowed) throw new Error(`Permission denied for ${tool || 'operation'} (role: ${role}).`);
  }
}
function createPermissionManager(options) { return new PermissionManager(options); }
module.exports = { PermissionManager, createPermissionManager };
