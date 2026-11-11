'use strict';
class ToolRegistry {
  constructor({ permissions, audit, approvals } = {}) { this.tools = new Map(); this.permissions = permissions; this.audit = audit; this.approvals = approvals; }
  register(tool) {
    if (!tool || !/^[a-z][a-z0-9_]{1,63}$/.test(tool.name || '') || typeof tool.handler !== 'function') throw new Error('Invalid tool registration');
    if (!tool.description || !tool.parameters || typeof tool.parameters !== 'object') throw new Error(`Tool ${tool.name} needs a description and parameter schema`);
    this.tools.set(tool.name, Object.freeze({ ...tool }));
    return this;
  }
  unregister(name) { return this.tools.delete(name); }
  describe() { return [...this.tools.values()].map(({ name, description, parameters, permissions, requiresApproval }) => ({ name, description, parameters, permissions: permissions || ['user'], requiresApproval: !!requiresApproval })); }
  validateValue(rule, value, key) {
    if (rule.type === 'string' && typeof value !== 'string') throw new Error(`${key} must be a string`);
    if (rule.type === 'integer' && !Number.isInteger(value)) throw new Error(`${key} must be an integer`);
    if (rule.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${key} must be a finite number`);
    if (rule.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
    if (rule.type === 'array') {
      if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
      if (rule.minItems !== undefined && value.length < rule.minItems) throw new Error(`${key} has too few items`);
      if (rule.maxItems !== undefined && value.length > rule.maxItems) throw new Error(`${key} has too many items`);
      if (rule.items) value.forEach((item, index) => this.validateValue(rule.items, item, `${key}[${index}]`));
    }
    if (rule.type === 'object') this.validateArguments(rule, value, key);
    if (rule.enum && !rule.enum.includes(value)) throw new Error(`${key} has an unsupported value`);
    if (rule.minimum !== undefined && typeof value === 'number' && value < rule.minimum) throw new Error(`${key} is below its minimum`);
    if (rule.maximum !== undefined && typeof value === 'number' && value > rule.maximum) throw new Error(`${key} exceeds its maximum`);
    if (rule.minLength !== undefined && typeof value === 'string' && value.length < rule.minLength) throw new Error(`${key} is too short`);
    if (rule.maxLength !== undefined && typeof value === 'string' && value.length > rule.maxLength) throw new Error(`${key} is too long`);
  }
  validateArguments(schema, args, prefix = 'arguments') {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object');
    if (schema.additionalProperties === false) for (const key of Object.keys(args)) if (!schema.properties?.[key]) throw new Error(`Unexpected argument: ${key}`);
    for (const key of schema.required || []) if (!(key in args)) throw new Error(`Missing required argument: ${key}`);
    for (const [key, value] of Object.entries(args)) {
      const rule = schema.properties?.[key];
      if (rule) this.validateValue(rule, value, `${prefix}.${key}`);
    }
  }
  catalog({ actor, context = {} } = {}) {
    const role = this.permissions?.role(actor, context) || 'user';
    const levels = { user: 1, admin: 2, owner: 3 };
    return [...this.tools.values()].filter(tool => (tool.permissions || ['user']).some(required => required === 'public' || levels[role] >= (levels[required] || 99))).map(tool => ({
      name: tool.name, description: String(tool.description).slice(0, 150), requiresApproval: !!tool.requiresApproval
    }));
  }
  async execute(name, args, context = {}) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    this.validateArguments(tool.parameters, args || {});
    const actor = String(context.actor || 'anonymous');
    const now = Date.now();
    this.rateLimits ||= new Map();
    const recent = (this.rateLimits.get(actor) || []).filter(t => now - t < 60000);
    if (recent.length >= 12) throw new Error('Tool rate limit exceeded. Try again in one minute.');
    recent.push(now); this.rateLimits.set(actor, recent);
    if (this.permissions) await this.permissions.assert({ actor: context.actor, required: tool.permissions || ['user'], context, tool: name });
    if (tool.requiresApproval && context.approved !== true) {
      if (!this.approvals) throw new Error(`Approval is required for ${name}, but the approval manager is unavailable.`);
      return { success: false, tool: name, result: await this.approvals.request({ tool: name, args: args || {}, context }) };
    }
    const started = Date.now();
    try {
      const result = await tool.handler(args || {}, context);
      await this.audit?.write({ type: 'tool.success', actor: context.actor, tool: name, durationMs: Date.now()-started });
      return { success: true, tool: name, result };
    } catch (error) {
      await this.audit?.write({ type: 'tool.failure', actor: context.actor, tool: name, durationMs: Date.now()-started, error: String(error.message).slice(0,300) });
      throw error;
    }
  }
}
function createToolRegistry(options) { return new ToolRegistry(options); }
module.exports = { ToolRegistry, createToolRegistry };
