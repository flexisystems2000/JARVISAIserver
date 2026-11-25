'use strict';
const axios = require('axios');

class SupabaseAgent {
  constructor({ url = process.env.SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY, client = axios } = {}) {
    this.url = String(url || '').trim().replace(/\/$/, '');
    this.serviceKey = String(serviceKey || '').trim();
    this.client = client;
  }
  assertConfigured() {
    if (!this.url || !/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(this.url)) throw new Error('SUPABASE_URL must be a valid HTTPS project URL.');
    if (!this.serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured in the hosting environment.');
  }
  validateTableName(table) {
    if (typeof table !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(table)) throw new Error('Invalid Supabase table name.');
    return table;
  }
  async request(path, params = {}) {
    this.assertConfigured();
    const response = await this.client.get(this.url + path, {
      params, timeout: 15000, maxRedirects: 0, maxContentLength: 512 * 1024,
      headers: { apikey: this.serviceKey, Authorization: 'Bearer ' + this.serviceKey, Accept: 'application/json' }
    });
    return response.data;
  }
  async checkConnection() {
    const data = await this.request('/rest/v1/');
    const paths = data && typeof data === 'object' ? Object.keys(data.paths || {}) : [];
    return { connected: true, projectUrl: this.url, exposedTableCount: paths.length, exposedTables: paths.map(path => path.replace(/^\//, '')).filter(Boolean).slice(0, 100) };
  }
  async readTable(table, limit = 25) {
    const safeTable = this.validateTableName(table);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 25, 100));
    const rows = await this.request('/rest/v1/' + encodeURIComponent(safeTable), { select: '*', limit: safeLimit });
    if (!Array.isArray(rows)) throw new Error('Supabase did not return a table row array. Check that the table is exposed through PostgREST.');
    return { table: safeTable, count: rows.length, rows };
  }
}
module.exports = { SupabaseAgent };
