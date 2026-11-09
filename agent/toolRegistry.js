'use strict';
function validateSchemaValue(schema, value, path) {
  const type = schema?.type;
  const invalid = expected => { throw new Error(`${path} must be ${expected}`); };
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('an object');
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!schema.properties?.[key]) throw new Error(`Unexpected argument: ${path === 'arguments' ? key : `${path}.${key}`}`);
    }
    for (const key of schema.required || []) if (!(key in value)) throw new Error(`Missing required argument: ${path === 'arguments' ? key : `${path}.${key}`}`);
    for (const [key, child] of Object.entries(value)) {
      const rule = schema.properties?.[key];
      if (rule) validateSchemaValue(rule, child, `${path}.${key}`);
    }
  } else if (type === 'array') {
    if (!Array.isArray(value)) invalid('an array');
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`${path} has too few items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`${path} has too many items`);
    if (schema.items) value.forEach((item, index) => validateSchemaValue(schema.items, item, `${path}[${index}]`));
  } else if (type === 'string') {
    if (typeof value !== 'string') invalid('a string');
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new Error(`${path} is too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) throw new Error(`${path} is too long`);
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) throw new Error(`${path} has an invalid format`);
  } else if (type === 'integer') {
    if (!Number.isInteger(value)) invalid('an integer');
  } else if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) invalid('a finite number');
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') invalid('a boolean');
  } else if (type && type !== 'null') {
    throw new Error(`Unsupported schema type ${type} at ${path}`);
  }
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} has an unsupported value`);
  if (schema.minimum !== undefined && typeof value === 'number' && value < schema.minimum) throw new Error(`${path} is below its minimum`);
  if (schema.maximum !== undefined && typeof value === 'number' && value > schema.maximum) throw new Error(`${path} exceeds its maximum`);
}
class ToolRegistry {
  constructor({ permissions, audit, approvals } = {}) {
    this.tools = new Map(); this.permissions = permissions; this.audit = audit; this.approvals = approvals;
  }
  register(tool) {
    if (!tool || !/^[a-z][a-z0-9_]{1,63}$/.test(tool.name || '') || typeof tool.handler !== 'function') throw new Error('Invalid tool registration');
    if (!tool.description || !tool.parameters || typeof tool.parameters !== 'object') throw new Error(`Tool ${tool.name} needs a description and parameter schema`);
    this.tools.set(tool.name, Object.freeze({ ...tool })); return this;
  }
  unregister(name) { return this.tools.delete(name); }
  canActorUse(tool, actor) {
    const required = tool.permissions || ['user'];
    if (required.includes('public') || !this.permissions) return true;
    const role = this.permissions.role(actor);
    const levels = { user: 1, admin: 2, owner: 3 };
    return required.some(r => levels[role] >= (levels[r] || 99));
  }
  catalog({ actor, maxTools = 180, descriptionLimit = 150 } = {}) {
    return [...this.tools.values()]
      .filter(tool => this.canActorUse(tool, actor))
      .slice(0, Math.max(1, Math.min(Number(maxTools) || 180, 250)))
      .map(({ name, description, permissions, requiresApproval, dynamicCommand }) => ({
        name,
        description: String(description).replace(/\s+/g, ' ').slice(0, descriptionLimit),
        ...(requiresApproval ? { approval: true } : {}),
        ...(dynamicCommand ? { dynamic: true } : {})
      }));
  }
  describe(names) {
    const selected = names == null ? [...this.tools.values()] : names.map(name => this.tools.get(name)).filter(Boolean);
    return selected.map(({ name, description, parameters, permissions, requiresApproval }) => ({
      name, description, parameters, permissions: permissions || ['user'], requiresApproval: !!requiresApproval
    }));
  }
  validateArguments(schema, args) {
    validateSchemaValue(schema, args, 'arguments');
  }
  async execute(name, args, context = {}) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    this.validateArguments(tool.parameters, args || {});
    const actor = String(context.actor || 'anonymous'), now = Date.now();
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
