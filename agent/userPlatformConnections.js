'use strict';

const crypto = require('crypto');
const axios = require('axios');

const PROVIDERS = {
  github: {
    label: 'GitHub',
    clientIdEnv: 'GITHUB_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GITHUB_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userUrl: 'https://api.github.com/user',
    scopes: ['read:user', 'repo', 'workflow'],
    tokenAuth: 'body',
    async identify(token) {
      const r = await axios.get(this.userUrl, { timeout: 15000, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
      return { id: String(r.data.id), username: r.data.login, email: r.data.email || null };
    }
  },
  supabase: {
    label: 'Supabase',
    clientIdEnv: 'SUPABASE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'SUPABASE_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://api.supabase.com/v1/oauth/authorize',
    tokenUrl: 'https://api.supabase.com/v1/oauth/token',
    userUrl: 'https://api.supabase.com/v1/profile',
    scopes: [],
    tokenAuth: 'basic',
    async identify(token) {
      const r = await axios.get(this.userUrl, { timeout: 15000, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      const id = r.data.id || r.data.user_id || r.data.email;
      if (!id) throw new Error('Supabase did not return a verified account identity.');
      return { id: String(id), username: r.data.username || r.data.name || null, email: r.data.email || null };
    }
  },
  google: {
    label: 'Google / Firebase',
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/datastore'],
    tokenAuth: 'body',
    extraAuthorize: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    async identify(token) {
      const r = await axios.get(this.userUrl, { timeout: 15000, headers: { Authorization: `Bearer ${token}` } });
      if (!r.data.sub) throw new Error('Google did not return a verified account identity.');
      return { id: String(r.data.sub), username: r.data.name || null, email: r.data.email || null };
    }
  },
  vercel: {
    label: 'Vercel',
    clientIdEnv: 'VERCEL_OAUTH_CLIENT_ID',
    clientSecretEnv: 'VERCEL_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://vercel.com/oauth/authorize',
    tokenUrl: 'https://api.vercel.com/login/oauth/token',
    userUrl: 'https://api.vercel.com/login/oauth/userinfo',
    scopes: ['openid', 'email', 'profile', 'offline_access'],
    tokenAuth: 'body',
    async identify(token) {
      const r = await axios.get(this.userUrl, { timeout: 15000, headers: { Authorization: `Bearer ${token}` } });
      if (!r.data.sub) throw new Error('Vercel did not return a verified account identity.');
      return { id: String(r.data.sub), username: r.data.preferred_username || r.data.name || null, email: r.data.email || null };
    }
  }
  ,
  gitlab: {
    label: 'GitLab',
    clientIdEnv: 'GITLAB_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GITLAB_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    userUrl: 'https://gitlab.com/api/v4/user',
    scopes: ['read_user', 'api'],
    tokenAuth: 'body',
    async identify(token) {
      const r = await axios.get(this.userUrl, { timeout: 15000, headers: { Authorization: `Bearer ${token}` } });
      if (!r.data.id) throw new Error('GitLab did not return a verified account identity.');
      return { id: String(r.data.id), username: r.data.username || r.data.name || null, email: r.data.email || null };
    }
  },
  netlify: {
    label: 'Netlify',
    clientIdEnv: 'NETLIFY_OAUTH_CLIENT_ID',
    clientSecretEnv: 'NETLIFY_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://app.netlify.com/authorize',
    tokenUrl: 'https://api.netlify.com/oauth/token',
    userUrl: 'https://api.netlify.com/api/v1/user',
    scopes: [],
    pkce: false,
    tokenAuth: 'body',
    async identify(token) {
      const r = await axios.get(this.userUrl, { timeout: 15000, headers: { Authorization: `Bearer ${token}` } });
      if (!r.data.id) throw new Error('Netlify did not return a verified account identity.');
      return { id: String(r.data.id), username: r.data.full_name || r.data.slug || r.data.email || null, email: r.data.email || null };
    }
  },
  discord: {
    label: 'Discord',
    clientIdEnv: 'DISCORD_OAUTH_CLIENT_ID',
    clientSecretEnv: 'DISCORD_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userUrl: 'https://discord.com/api/users/@me',
    scopes: ['identify', 'email'],
    tokenAuth: 'body',
    async identify(token) {
      const r = await axios.get(this.userUrl, { timeout: 15000, headers: { Authorization: `Bearer ${token}` } });
      if (!r.data.id) throw new Error('Discord did not return a verified account identity.');
      return { id: String(r.data.id), username: r.data.global_name || r.data.username || null, email: r.data.email || null };
    }
  },
  notion: {
    label: 'Notion',
    clientIdEnv: 'NOTION_OAUTH_CLIENT_ID',
    clientSecretEnv: 'NOTION_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    userUrl: 'https://api.notion.com/v1/users/me',
    scopes: [],
    pkce: false,
    tokenAuth: 'basic',
    async identify(token) {
      const r = await axios.get(this.userUrl, { timeout: 15000, headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' } });
      const id = r.data.id || r.data.owner?.user?.id || r.data.workspace_id;
      if (!id) throw new Error('Notion did not return a verified account identity.');
      return { id: String(id), username: r.data.name || r.data.owner?.user?.name || r.data.workspace_name || null, email: r.data.person?.email || r.data.owner?.user?.person?.email || null };
    }
  },
  dropbox: {
    label: 'Dropbox',
    clientIdEnv: 'DROPBOX_OAUTH_CLIENT_ID',
    clientSecretEnv: 'DROPBOX_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    userUrl: 'https://api.dropboxapi.com/2/users/get_current_account',
    scopes: [],
    tokenAuth: 'basic',
    async identify(token) {
      const r = await axios.post(this.userUrl, null, { timeout: 15000, headers: { Authorization: `Bearer ${token}` } });
      if (!r.data.account_id) throw new Error('Dropbox did not return a verified account identity.');
      return { id: String(r.data.account_id), username: r.data.name?.display_name || null, email: r.data.email || null };
    }
  },
  figma: {
    label: 'Figma',
    clientIdEnv: 'FIGMA_OAUTH_CLIENT_ID',
    clientSecretEnv: 'FIGMA_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://www.figma.com/oauth',
    tokenUrl: 'https://api.figma.com/v1/oauth/token',
    userUrl: 'https://api.figma.com/v1/me',
    scopes: ['current_user:read', 'file_content:read', 'file_metadata:read'],
    pkce: false,
    tokenAuth: 'basic',
    async identify(token) {
      const r = await axios.get(this.userUrl, { timeout: 15000, headers: { Authorization: `Bearer ${token}` } });
      if (!r.data.id) throw new Error('Figma did not return a verified account identity.');
      return { id: String(r.data.id), username: r.data.handle || r.data.email || null, email: r.data.email || null };
    }
  },
  linear: {
    label: 'Linear',
    clientIdEnv: 'LINEAR_OAUTH_CLIENT_ID',
    clientSecretEnv: 'LINEAR_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    userUrl: 'https://api.linear.app/graphql',
    scopes: ['read', 'write'],
    tokenAuth: 'body',
    async identify(token) {
      const r = await axios.post(this.userUrl, { query: 'query { viewer { id name email } }' }, { timeout: 15000, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
      const user = r.data.data?.viewer;
      if (!user?.id) throw new Error('Linear did not return a verified account identity.');
      return { id: String(user.id), username: user.name || null, email: user.email || null };
    }
  }

  ,
  asana: {
    label: 'Asana',
    clientIdEnv: 'ASANA_OAUTH_CLIENT_ID',
    clientSecretEnv: 'ASANA_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://app.asana.com/-/oauth_authorize',
    tokenUrl: 'https://app.asana.com/-/oauth_token',
    userUrl: 'https://app.asana.com/api/1.0/users/me',
    scopes: ['users:read', 'projects:read', 'projects:write', 'tasks:read', 'tasks:write'],
    tokenAuth: 'body',
    async identify(token) {
      const r = await axios.get(this.userUrl, { timeout: 15000, headers: { Authorization: `Bearer ${token}` } });
      const user = r.data.data;
      if (!user?.gid) throw new Error('Asana did not return a verified account identity.');
      return { id: String(user.gid), username: user.name || null, email: user.email || null };
    }
  },
  atlassian: {
    label: 'Atlassian',
    clientIdEnv: 'ATLASSIAN_OAUTH_CLIENT_ID',
    clientSecretEnv: 'ATLASSIAN_OAUTH_CLIENT_SECRET',
    authorizeUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    userUrl: 'https://api.atlassian.com/me',
    scopes: ['read:me', 'read:jira-user', 'read:jira-work', 'write:jira-work', 'offline_access'],
    tokenAuth: 'body',
    extraAuthorize: { audience: 'api.atlassian.com', prompt: 'consent' },
    async identify(token) {
      const r = await axios.get(this.userUrl, { timeout: 15000, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      const id = r.data.account_id || r.data.accountId || r.data.sub;
      if (!id) throw new Error('Atlassian did not return a verified account identity.');
      return { id: String(id), username: r.data.name || r.data.nickname || null, email: r.data.email || null };
    }
  }

};

function b64url(value) { return Buffer.from(value).toString('base64url'); }
function sha(value) { return crypto.createHash('sha256').update(value).digest('base64url'); }

class UserPlatformConnections {
  constructor({ mongoose, baseUrl } = {}) {
    if (!mongoose) throw new Error('Mongoose is required for platform connections.');
    this.mongoose = mongoose;
    this.baseUrl = String(baseUrl || process.env.PLATFORM_OAUTH_BASE_URL || '').replace(/\/$/, '');
    const schema = new mongoose.Schema({
      actor: { type: String, required: true },
      provider: { type: String, required: true },
      providerUserId: { type: String, required: true },
      username: String,
      email: String,
      encryptedTokens: { type: String, required: true },
      scopes: [String],
      connectedAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now }
    }, { minimize: false });
    schema.index({ actor: 1, provider: 1 }, { unique: true });
    this.Connection = mongoose.models.UserPlatformConnection || mongoose.model('UserPlatformConnection', schema);
    const stateSchema = new mongoose.Schema({
      stateHash: { type: String, unique: true, required: true },
      actor: { type: String, required: true },
      provider: { type: String, required: true },
      verifier: { type: String, required: true },
      expiresAt: { type: Date, required: true }
    });
    stateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    this.State = mongoose.models.PlatformOAuthState || mongoose.model('PlatformOAuthState', stateSchema);
  }
  key() {
    const raw = process.env.PLATFORM_TOKEN_ENCRYPTION_KEY || '';
    let key;
    if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
    else { try { key = Buffer.from(raw, 'base64'); } catch (_) {} }
    if (!key || key.length !== 32) throw new Error('PLATFORM_TOKEN_ENCRYPTION_KEY must be a 32-byte base64 or 64-character hex key.');
    return key;
  }
  encrypt(value) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', this.key(), iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
  }
  decrypt(value) {
    const [iv, tag, body] = String(value).split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8'));
  }
  config(provider) {
    const p = PROVIDERS[provider];
    if (!p) throw new Error(`Unsupported OAuth provider. Available: ${Object.keys(PROVIDERS).join(', ')}.`);
    const clientId = process.env[p.clientIdEnv], clientSecret = process.env[p.clientSecretEnv];
    if (!clientId || !clientSecret) throw new Error(`${p.label} OAuth is not configured yet. Missing ${p.clientIdEnv} or ${p.clientSecretEnv}.`);
    if (!this.baseUrl || !this.baseUrl.startsWith('https://')) throw new Error('PLATFORM_OAUTH_BASE_URL must be the public HTTPS base URL of JARVIS.');
    return { p, clientId, clientSecret, redirectUri: `${this.baseUrl}/auth/platform/callback/${provider}` };
  }
  async begin(provider, actor) {
    const owner = String(actor || '').trim();
    if (!owner || !owner.includes('@')) throw new Error('A valid WhatsApp sender identity is required.');
    const { p, clientId, redirectUri } = this.config(provider);
    const state = b64url(crypto.randomBytes(32));
    const verifier = b64url(crypto.randomBytes(48));
    await this.State.create({ stateHash: sha(state), actor: owner, provider, verifier, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
    const url = new URL(p.authorizeUrl);
    const params = { client_id: clientId, redirect_uri: redirectUri, response_type: 'code', state };
    if (p.pkce !== false) { params.code_challenge = sha(verifier); params.code_challenge_method = 'S256'; }
    if (provider !== 'supabase' && p.scopes.length) params.scope = p.scopes.join(' ');
    // Supabase scopes are configured on the registered OAuth app; its docs mark
    // the request-time scope parameter as deprecated.
    Object.assign(params, p.extraAuthorize || {});
    for (const [k,v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
    return { url: url.toString(), provider: p.label, expiresInMinutes: 10 };
  }
  async callback(provider, code, state) {
    const { p, clientId, clientSecret, redirectUri } = this.config(provider);
    const pending = await this.State.findOneAndDelete({ stateHash: sha(String(state || '')), provider, expiresAt: { $gt: new Date() } });
    if (!pending) throw new Error('OAuth state is invalid, expired, or already used. Start the connection again.');
    const body = new URLSearchParams({ grant_type: 'authorization_code', code: String(code || ''), redirect_uri: redirectUri });
    if (p.pkce !== false) body.set('code_verifier', pending.verifier);
    let headers = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };
    if (p.tokenAuth === 'basic') headers.Authorization = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    else { body.set('client_id', clientId); body.set('client_secret', clientSecret); }
    const tokenResponse = await axios.post(p.tokenUrl, body.toString(), { timeout: 20000, headers });
    const tokens = tokenResponse.data;
    if (!tokens.access_token) throw new Error(`${p.label} did not return an access token.`);
    const identity = await p.identify(tokens.access_token);
    const tokenSet = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || null, tokenType: tokens.token_type || 'Bearer', expiresAt: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : null };
    await this.Connection.findOneAndUpdate(
      { actor: pending.actor, provider },
      { $set: { providerUserId: identity.id, username: identity.username || '', email: identity.email || '', encryptedTokens: this.encrypt(tokenSet), scopes: String(tokens.scope || '').split(/[ ,]+/).filter(Boolean), updatedAt: new Date() }, $setOnInsert: { connectedAt: new Date() } },
      { upsert: true, new: true }
    );
    return { provider: p.label, actor: pending.actor, account: identity.username || identity.email || identity.id };
  }
  async list(actor) {
    const rows = await this.Connection.find({ actor: String(actor || '') }).select('provider username email scopes connectedAt updatedAt').lean();
    return rows.map(x => ({ provider: x.provider, account: x.username || x.email || x.providerUserId, scopes: x.scopes || [], connectedAt: x.connectedAt }));
  }
  async disconnect(actor, provider) {
    if (!PROVIDERS[provider]) throw new Error('Unsupported OAuth provider.');
    const result = await this.Connection.deleteOne({ actor: String(actor || ''), provider });
    return { disconnected: result.deletedCount === 1, provider };
  }
  async accessToken(actor, provider) {
    const row = await this.Connection.findOne({ actor: String(actor || ''), provider });
    if (!row) throw new Error(`${provider} is not connected for this WhatsApp account.`);
    const tokens = this.decrypt(row.encryptedTokens);
    if (!tokens.expiresAt || tokens.expiresAt > Date.now() + 60000) return tokens.accessToken;
    if (!tokens.refreshToken) throw new Error(`${provider} connection expired. Reconnect the platform.`);
    const { p, clientId, clientSecret } = this.config(provider);
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
    let headers = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };
    if (p.tokenAuth === 'basic') headers.Authorization = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    else { body.set('client_id', clientId); body.set('client_secret', clientSecret); }
    const r = await axios.post(p.tokenUrl, body.toString(), { timeout: 20000, headers });
    if (!r.data.access_token) throw new Error(`${provider} token refresh failed. Reconnect the platform.`);
    const next = { accessToken: r.data.access_token, refreshToken: r.data.refresh_token || tokens.refreshToken, tokenType: r.data.token_type || 'Bearer', expiresAt: r.data.expires_in ? Date.now() + Number(r.data.expires_in) * 1000 : null };
    row.encryptedTokens = this.encrypt(next); row.updatedAt = new Date(); await row.save();
    return next.accessToken;
  }
}
module.exports = { UserPlatformConnections, PROVIDERS };
