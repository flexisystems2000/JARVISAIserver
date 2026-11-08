'use strict';

/**
 * Platform-neutral authorization broker. Credentials are read from environment
 * variables only; JARVIS never asks users to paste passwords or OTPs into chat.
 * A provider is usable only when its adapter can verify the credential against
 * the provider's own identity API and return the verified account identity.
 */
class PlatformAuth {
  constructor({ providers = {} } = {}) {
    this.providers = new Map();
    this.verified = new Map();
    this.register('github', {
      tokenEnv: 'GITHUB_TOKEN',
      async verify(token) {
        const axios = require('axios');
        const client = axios.create({ baseURL: 'https://api.github.com', timeout: 15000, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
        const [user, repos] = await Promise.all([client.get('/user'), client.get('/user/repos', { params: { per_page: 1 } })]);
        return { account: user.data.login, id: user.data.id, role: user.data.type === 'Organization' ? 'organization' : 'authenticated-user', verified: true, accessibleResourceCount: repos.headers['link'] ? 'multiple/pages' : repos.data.length };
      }
    });
    for (const [name, provider] of Object.entries(providers)) this.register(name, provider);
    // Optional declarative adapters for REST platforms. Example:
    // JARVIS_PLATFORM_ADAPTERS='[{"name":"cloudflare","tokenEnv":"CLOUDFLARE_API_TOKEN","verifyUrl":"https://api.cloudflare.com/client/v4/user/tokens/verify","accountPath":"result.id"}]'
    if (process.env.JARVIS_PLATFORM_ADAPTERS) {
      let configured;
      try { configured = JSON.parse(process.env.JARVIS_PLATFORM_ADAPTERS); } catch { throw new Error('JARVIS_PLATFORM_ADAPTERS must be valid JSON'); }
      if (!Array.isArray(configured)) throw new Error('JARVIS_PLATFORM_ADAPTERS must be a JSON array');
      for (const item of configured) {
        if (!item || typeof item.name !== 'string' || typeof item.tokenEnv !== 'string' || typeof item.verifyUrl !== 'string' || !/^https:\/\//i.test(item.verifyUrl)) throw new Error('Each platform adapter requires name, tokenEnv and an HTTPS verifyUrl');
        this.register(item.name, { tokenEnv: item.tokenEnv, async verify(token) {
          const axios = require('axios');
          const response = await axios.get(item.verifyUrl, { timeout: 15000, maxRedirects: 0, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
          const path = String(item.accountPath || 'id').split('.');
          let account = response.data;
          for (const key of path) account = account?.[key];
          const valid = item.validPath ? String(item.validPath).split('.').reduce((v, k) => v?.[k], response.data) : true;
          if (valid === false) throw new Error(`${item.name} rejected the supplied token`);
          return { account: account == null ? '' : String(account), role: 'verified-token-holder', verified: Boolean(account) };
        }});
      }
    }
  }
  register(name, adapter) {
    const key = String(name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!key || !adapter || typeof adapter.verify !== 'function' || !adapter.tokenEnv) throw new Error('A platform adapter requires a name, tokenEnv and verify(token) function');
    this.providers.set(key, Object.freeze({ ...adapter }));
    return this;
  }
  list() { return [...this.providers.keys()]; }
  async verify(name) {
    const key = String(name || '').toLowerCase();
    const adapter = this.providers.get(key);
    if (!adapter) throw new Error(`No verified connector is installed for ${key}. Add a provider adapter before using this platform.`);
    const token = process.env[adapter.tokenEnv];
    if (!token) throw new Error(`${key} is not connected. Configure ${adapter.tokenEnv} with a least-privilege API token in your hosting environment.`);
    const identity = await adapter.verify(token);
    if (!identity || identity.verified !== true || !identity.account) throw new Error(`${key} did not confirm an authenticated account.`);
    const record = { platform: key, account: String(identity.account), role: identity.role || 'unknown', verifiedAt: new Date().toISOString(), identity };
    this.verified.set(key, record);
    return record;
  }
  getVerified(name) { return this.verified.get(String(name || '').toLowerCase()) || null; }
}
module.exports = { PlatformAuth };
