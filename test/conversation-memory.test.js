'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getConversationKey, buildConversationRecords, saveConversationTurn, getConversationContext } = require('../agent/conversationMemory');

function memoryModel() {
  const rows = [];
  const Model = {
    rows,
    async updateOne(filter, update) {
      if (!rows.some(row => row.conversationKey === filter.conversationKey && row.interactionId === filter.interactionId && row.role === filter.role)) {
        rows.push({ ...update.$setOnInsert, _id: `${rows.length + 1}`, createdAt: new Date(rows.length) });
      }
    },
    find(filter) {
      let data = rows.filter(row => row.conversationKey === filter.conversationKey);
      const query = {
        sort() { data = [...data].sort((a,b) => b.createdAt - a.createdAt); return query; },
        limit(n) { data = data.slice(0,n); return query; },
        skip(n) { data = data.slice(n); return query; },
        select() { return query; },
        lean: async () => data
      };
      return query;
    },
    async deleteMany() {}
  };
  return Model;
}

test('conversation history is isolated by chat and participant', () => {
  assert.notEqual(getConversationKey('group-a@g.us','user-1'), getConversationKey('group-a@g.us','user-2'));
  assert.notEqual(getConversationKey('group-a@g.us','user-1'), getConversationKey('group-b@g.us','user-1'));
});

test('a persisted interaction stores both user and assistant turns once', async () => {
  const Model = memoryModel();
  const input = { chatJid:'chat@g.us', userJid:'person@s.whatsapp.net', userText:'Create a report', assistantText:'The report request was processed.', interactionId:'wamid-123' };
  assert.equal(buildConversationRecords(input).length, 2);
  await saveConversationTurn(Model, input);
  await saveConversationTurn(Model, input);
  assert.equal(Model.rows.length, 2);
  assert.deepEqual(Model.rows.map(row => row.role).sort(), ['assistant','user']);
});

test('recent conversation context is returned in chronological order', async () => {
  const Model = memoryModel();
  await saveConversationTurn(Model, { chatJid:'chat', userJid:'person', userText:'First question', assistantText:'First answer', interactionId:'1' });
  await saveConversationTurn(Model, { chatJid:'chat', userJid:'person', userText:'Second question', assistantText:'Second answer', interactionId:'2' });
  const context = await getConversationContext(Model, 'chat', 'person', 12);
  assert.ok(context.indexOf('First question') < context.indexOf('Second question'));
  assert.match(context, /JARVIS: Second answer/);
});
