'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ApprovalManager {
  constructor({ directory, ttlMs = 10 * 60 * 1000, audit } = {}) {
    this.directory = directory || path.join(process.cwd(), 'data', 'approvals');
    this.ttlMs = ttlMs;
    this.audit = audit;
    this.pending = new Map();
  }
  async load() {
    await fs.promises.mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const name of await fs.promises.readdir(this.directory)) {
      if (!name.endsWith('.json')) continue;
      try {
        const item = JSON.parse(await fs.promises.readFile(path.join(this.directory, name), 'utf8'));
        if (item.status === 'pending' && item.expiresAt > Date.now()) this.pending.set(item.id, item);
        else await fs.promises.unlink(path.join(this.directory, name)).catch(() => {});
      } catch (_) {}
    }
  }
  async persist(item) {
    const target = path.join(this.directory, `${item.id}.json`);
    const temp = `${target}.tmp`;
    await fs.promises.writeFile(temp, JSON.stringify(item, null, 2), { mode: 0o600 });
    await fs.promises.rename(temp, target);
  }
  async request({ tool, args, context = {} }) {
    const id = crypto.randomBytes(4).toString('hex').toUpperCase();
    const item = {
      id, tool, args,
      requester: String(context.actor || ''),
      chatId: String(context.chatId || ''),
      isGroup: !!context.isGroup,
      createdAt: Date.now(), expiresAt: Date.now() + this.ttlMs,
      status: 'pending'
    };
    this.pending.set(id, item);
    await this.persist(item);
    await this.audit?.write({ type: 'approval.requested', approvalId: id, actor: item.requester, tool });
    return { approvalRequired: true, approvalId: id, expiresAt: new Date(item.expiresAt).toISOString(), message: `Approval ${id} is pending. The JARVIS owner/system admin or an administrator of the requesting WhatsApp group can use !approve ${id} or !reject ${id}.` };
  }
  async decide(id, { actor, isOwner = false, isSystemAdmin = false, isGroupAdmin = false, chatId = '', approve = false, execute }) {
    const key = String(id || '').toUpperCase();
    const item = this.pending.get(key);
    if (!item || item.expiresAt <= Date.now()) {
      if (item) this.pending.delete(key);
      throw new Error('Approval not found or expired.');
    }
    const sameRequestingGroup = !!item.isGroup && !!item.chatId && String(chatId) === String(item.chatId);
    if (!isOwner && !isSystemAdmin && !(isGroupAdmin && sameRequestingGroup)) throw new Error('Approval requires the JARVIS owner/system admin or an administrator of the WhatsApp group where the action was requested.');
    if (typeof execute !== 'function' && approve) throw new Error('Approval executor unavailable.');
    this.pending.delete(key);
    item.status = approve ? 'approved' : 'rejected';
    item.decidedAt = Date.now();
    item.decidedBy = String(actor || '');
    await this.persist(item);
    await this.audit?.write({ type: `approval.${item.status}`, approvalId: key, actor: item.decidedBy, requester: item.requester, tool: item.tool });
    if (!approve) return { status: 'rejected', approvalId: key, tool: item.tool };
    try {
      const result = await execute(item);
      item.status = 'executed';
      await this.persist(item);
      await this.audit?.write({ type: 'approval.executed', approvalId: key, actor: item.decidedBy, tool: item.tool });
      return { status: 'executed', approvalId: key, tool: item.tool, result };
    } catch (error) {
      item.status = 'execution_failed';
      item.error = String(error.message || error).slice(0, 300);
      await this.persist(item);
      await this.audit?.write({ type: 'approval.execution_failed', approvalId: key, actor: item.decidedBy, tool: item.tool, error: item.error });
      throw error;
    }
  }
  list({ chatId, includeAll = false } = {}) { return [...this.pending.values()].filter(x => includeAll || (chatId && x.isGroup && x.chatId === chatId)).map(x => ({ id: x.id, tool: x.tool, requester: x.requester, chatId: x.chatId, isGroup: x.isGroup, expiresAt: new Date(x.expiresAt).toISOString() })); }
}
module.exports = { ApprovalManager };
