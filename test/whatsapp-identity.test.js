'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveWhatsAppDisplayName } = require('../agent/whatsappIdentity');

test('WhatsApp push name takes priority', () => {
  assert.equal(resolveWhatsAppDisplayName({ message: { pushName: 'Ada Lovelace' }, sender: '123@s.whatsapp.net' }), 'Ada Lovelace');
});

test('group participant name is used when push name is absent', () => {
  const metadata = { participants: [{ id: '123@s.whatsapp.net', notify: 'Ada' }] };
  assert.equal(resolveWhatsAppDisplayName({ message: {}, sender: '123@s.whatsapp.net', groupMetadata: metadata }), 'Ada');
});

test('unknown contact is not assigned an invented name', () => {
  assert.equal(resolveWhatsAppDisplayName({ message: {}, sender: '123@s.whatsapp.net' }), 'WhatsApp user');
});
