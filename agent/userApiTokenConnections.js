'use strict';

const crypto = require('crypto');
const axios = require('axios');

const TOKEN_PROVIDERS = {
  cloudflare: {
    label: 'Cloudflare',
    validate: async token => {
      const r = await axios.get('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        timeout: 15000, headers: { Authorization: `Bearer ${token}` }
      });
      if (r.data?.success !== true || r.data?.result?.status !== 'active') throw new Error('Cloudflare token is invalid, inactive, or lacks verification access.');
      let account = 'Cloudflare account';
      try {
        const user = await axios.get('https://api.cloudflare.com/client/v4/user', { timeout: 10000, headers: { Authorization: `Bearer ${token}` } });
        account = user.data?.result?.email || user.data?.result?.username || account;
      } catch (_) {}
      return { id: account, account };
    }
  },
  render: {
    label: 'Render',
    validate: async token => {
      const r = await axios.get('https://api.render.com/v1/owners?limit=1', {
        timeout: 15000, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
      });
      const owner = Array.isArray(r.data) ? r.data[0]?.owner : null;
      return { id: owner?.id || 'render-token', account: owner?.name || owner?.email || 'Render account' };
    }
  },
  railway: {
    label: 'Railway',
    validate: async token => {
      const r = await axios.post('https://backboard.railway.app/graphql/v2',
        { query: 'query { me { id name email } }' },
        { timeout: 15000, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      const me = r.data?.data?.me;
      if (!me?.id || r.data?.errors?.length) throw new Error('Railway rejected the token or did not grant account access.');
      return { id: String(me.id), account: me.name || me.email || 'Railway account' };
    }
  },
  digitalocean: {
    label: 'DigitalOcean',
    validate: async token => {
      const r = await axios.get('https://api.digitalocean.com/v2/account', {
        timeout: 15000, headers: { Authorization: `Bearer ${token}` }
      });
      const account = r.data?.account;
      if (!account?.uuid && !account?.email) throw new Error('DigitalOcean did not return an authenticated account.');
      return { id: String(account.uuid || account.email), account: account.email || account.uuid };
    }
  },
  stripe: {
    label: 'Stripe',
    validate: async token => {
      const r = await axios.get('https://api.stripe.com/v1/account', {
        timeout: 15000, headers: { Authorization: `Bearer ${token}` }
      });
      const account = r.data;
      if (!account?.id) throw new Error('Stripe did not return an authenticated account.');
      return { id: String(account.id), account: account.business_profile?.name || account.email || account.id };
    }
  },
  resend: {
    label: 'Resend',
    validate: async token => {
      const r = await axios.get('https://api.resend.com/domains', {
        timeout: 15000, headers: { Authorization: `Bearer ${token}` }
      });
      if (!Array.isArray(r.data?.data)) throw new Error('Resend did not return an authenticated API response.');
      return { id: 'resend-api-key', account: 'Resend account' };
    }
  },
  openai: {
    label: 'OpenAI',
    validate: async token => {
      const r = await axios.get('https://api.openai.com/v1/models', {
        timeout: 15000, headers: { Authorization: `Bearer ${token}` }
      });
      if (!Array.isArray(r.data?.data)) throw new Error('OpenAI did not return an authenticated API response.');
      return { id: 'openai-api-key', account: 'OpenAI API account' };
    }
  }
};

class UserApiTokenConnections {
  constructor({ mongoose } = {}) {
    if (!mongoose) throw new Error('Mongoose is required for API token connections.');
    const schema = new mongoose.Schema({
      actor: { type: String, required: true },
      provider: { type: String, required: true },
      providerAccountId: { type: String, default: '' },
      account: { type: String, default: '' },
      encryptedToken: { type: String, required: true },
      validatedAt: { type: Date, required: true },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now }
    });
    schema.index({ actor: 1, provider: 1 }, { unique: true });
    this.Connection = mongoose.models.UserApiTokenConnection || mongoose.model('UserApiTokenConnection', schema);
  }

  key() {
    const raw = process.env.PLATFORM_TOKEN_ENCRYPTION_KEY || '';
    let key;
    if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
    else { try { key = Buffer.from(raw, 'base64'); } catch (_) {} }
    if (!key || key.length !== 32) throw new Error('API token storage is not configured securely. Ask the JARVIS operator to configure PLATFORM_TOKEN_ENCRYPTION_KEY.');
    return key;
  }

  encrypt(token) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
    return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
  }

  decrypt(value) {
    const [iv, tag, encrypted] = String(value).split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
  }

  async connect(actor, provider, token) {
    const owner = String(actor || '').trim();
    const name = String(provider || '').toLowerCase().trim();
    const secret = String(token || '').trim();
    if (!owner || !owner.includes('@')) throw new Error('Could not identify your WhatsApp account.');
    const definition = TOKEN_PROVIDERS[name];
    if (!definition) throw new Error(`Unsupported token platform. Available: ${Object.keys(TOKEN_PROVIDERS).join(', ')}.`);
    if (secret.length < 12 || secret.length > 4096 || /[\\r\\n]/.test(secret)) throw new Error('The token format is not valid. Send one token on a single line.');
    // Validate before persisting. Never include the submitted token in errors or logs.
    let identity;\n    try { identity = await definition.validate(secret); }\n    catch (_) { throw new Error(`Could not validate the ${definition.label} token. Check that it is active and has permission to read your account details.`); }
    await this.Connection.findOneAndUpdate(
      { actor: owner, provider: name },
      { $set: {
        providerAccountId: String(identity.id || ''),
        account: String(identity.account || definition.label).slice(0, 180),
        encryptedToken: this.encrypt(secret),
        validatedAt: new Date(),
        updatedAt: new Date()
      }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, new: true }
    );
    return { connected: true, provider: definition.label, account: identity.account || definition.label };
  }

  async list(actor) {
    const rows = await this.Connection.find({ actor: String(actor || '') })
      .select('provider account validatedAt createdAt updatedAt').lean();
    return rows.map(row => ({
      provider: TOKEN_PROVIDERS[row.provider]?.label || row.provider,
      account: row.account || 'Validated account',
      validatedAt: row.validatedAt
    }));
  }

  async disconnect(actor, provider) {
    const name = String(provider || '').toLowerCase().trim();
    if (!TOKEN_PROVIDERS[name]) throw new Error('Unsupported API-token platform.');
    const result = await this.Connection.deleteOne({ actor: String(actor || ''), provider: name });
    return { disconnected: result.deletedCount === 1, provider: TOKEN_PROVIDERS[name].label };
  }

  async accessToken(actor, provider) {
    const name = String(provider || '').toLowerCase().trim();
    if (!TOKEN_PROVIDERS[name]) throw new Error('Unsupported API-token platform.');
    const row = await this.Connection.findOne({ actor: String(actor || ''), provider: name });
    if (!row) throw new Error(`${TOKEN_PROVIDERS[name].label} is not connected for this WhatsApp account.`);
    return this.decrypt(row.encryptedToken);
  }
}

module.exports = { UserApiTokenConnections, TOKEN_PROVIDERS };
