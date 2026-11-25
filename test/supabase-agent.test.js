'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SupabaseAgent } = require('../agent/supabaseAgent');

test('Supabase connector validates HTTPS URL and requires a protected service key', async () => {
  const agent = new SupabaseAgent({ url: 'http://localhost:54321', serviceKey: 'x' });
  await assert.rejects(() => agent.checkConnection(), /valid HTTPS project URL/);
  const missing = new SupabaseAgent({ url: 'https://example.supabase.co', serviceKey: '' });
  await assert.rejects(() => missing.checkConnection(), /SUPABASE_SERVICE_ROLE_KEY/);
});

test('Supabase connector rejects unsafe table names', async () => {
  const agent = new SupabaseAgent({ url: 'https://example.supabase.co', serviceKey: 'test' });
  assert.throws(() => agent.validateTableName('users;drop table'), /Invalid Supabase table name/);
  assert.equal(agent.validateTableName('student_records'), 'student_records');
});

test('Supabase table reads are bounded and return structured rows', async () => {
  const calls = [];
  const fake = { get: async (url, options) => { calls.push({ url, options }); return { data: [{ id: 1 }] }; } };
  const agent = new SupabaseAgent({ url: 'https://example.supabase.co', serviceKey: 'test', client: fake });
  const result = await agent.readTable('students', 1000);
  assert.equal(result.count, 1);
  assert.equal(calls[0].options.params.limit, 100);
  assert.equal(calls[0].options.headers.apikey, 'test');
});
