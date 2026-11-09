'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { COMMANDS, listCommands, getCommand } = require('../agent/commandRegistry');
const { createPermissionManager } = require('../agent/permissions');
const { createToolRegistry } = require('../agent/toolRegistry');

test('canonical command registry contains the complete menu inventory and aliases', () => {
  for (const command of [
    'ai','define','dictionary','quiz','stopquiz','command','command list','command create',
    'timetable','image','vv','createfile','create document','generate pdf',
    'crawl','sitecheck','translate','yt search','yt video','yt audio','yt download',
    'video','video status','remind','reminders','cancelreminder','tts on','tts off',
    'tts','tts enable','tts disable','tts status','quiet','unquiet','status','healthgraph','ginfo','listadmins',
    'listonline','getjid','groupids','getgroupids','groupname','add','kick',
    'remove all','ban','unban','promote','mute','unmute','reset','approvals',
    'approve','reject','pay month','pay week','name','addxxjarvis','addxxjarvis meta','create','generate','remove','menu','help',
    'settimetable'
  ]) assert.ok(getCommand(command), `missing !${command}`);
  assert.ok(COMMANDS.length >= 55, `unexpectedly small inventory: ${COMMANDS.length}`);
  assert.equal(getCommand('!help').name, 'help');
  assert.ok(listCommands({ category: 'Group management' }).some(x => x.name === 'mute'));
});

test('JARVIS system admins can inspect GitHub while WhatsApp group admins cannot', async () => {
  const permissions = createPermissionManager({ ownerNumber: '1111111111', adminNumbers: ['2222222222'] });
  const registry = createToolRegistry({ permissions });
  registry.register({
    name: 'github_read_test', description: 'read-only test',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    permissions: ['systemAdmin','owner'], handler: async () => ({ ok: true })
  });
  assert.equal((await registry.execute('github_read_test', {}, { actor: '2222222222@s.whatsapp.net' })).result.ok, true);
  assert.equal((await registry.execute('github_read_test', {}, { actor: '1111111111@s.whatsapp.net' })).result.ok, true);
  await assert.rejects(
    () => registry.execute('github_read_test', {}, { actor: '3333333333@s.whatsapp.net', isAdmin: true }),
    /Permission denied.*role: admin/
  );
});


test('configured JARVIS system admin is an eligible approval authority', async () => {
  const { ApprovalManager } = require('../agent/approvals');
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-admin-approval-'));
  try {
    const approvals = new ApprovalManager({ directory });
    await approvals.load();
    const request = await approvals.request({
      tool: 'safe_test', args: {},
      context: { actor: '9999999999@s.whatsapp.net', chatId: '123@g.us', isGroup: true }
    });
    const result = await approvals.decide(request.approvalId, {
      actor: '2222222222@s.whatsapp.net',
      isSystemAdmin: true,
      chatId: 'private-chat',
      approve: true,
      execute: async () => ({ executed: true })
    });
    assert.equal(result.status, 'executed');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('every command spelling in the live !menu is present in the canonical registry', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const menu = source.match(/const menuText = `([\s\S]*?)`;/)?.[1] || '';
  assert.ok(menu.length > 0, 'could not locate the !menu source');
  const spellings = new Set(menu.match(/!(?:[a-z][a-z0-9_-]*)(?:\s+(?:list|create|search|video|audio|download|status|off|on|month|week|all|meta))?/gi) || []);
  for (const spelling of spellings) {
    const normalized = spelling.slice(1).toLowerCase();
    assert.ok(getCommand(normalized), `!menu contains ${spelling} but registry does not`);
  }
});
