'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { unwrapGroupMessage, extractGroupMessageText, formatGroupTranscript, buildConversationAwarePrompt } = require('../agent/groupConversationMemory');

test('group memory extracts text from wrapped and captioned messages', () => {
  assert.equal(extractGroupMessageText({ ephemeralMessage: { message: { extendedTextMessage: { text: 'Build the website' } } } }), 'Build the website');
  assert.equal(extractGroupMessageText({ imageMessage: { caption: 'Design reference' } }), 'Design reference');
  assert.equal(extractGroupMessageText({ conversation: '  hello  ' }), 'hello');
});

test('group transcript preserves all participants and exact quoted-message attribution', () => {
  const transcript = formatGroupTranscript([
    { createdAt: new Date('2026-11-26T00:00:00Z'), senderName: 'Person A', senderJid: 'a@s.whatsapp.net', content: 'I think we should build a website.' },
    { createdAt: new Date('2026-11-26T00:01:00Z'), senderName: 'Person B', senderJid: 'b@s.whatsapp.net', content: 'I agree; add student registration.' }
  ], { messageId: 'quoted-1', senderName: 'Person A', content: 'I think we should build a website.' });
  assert.match(transcript, /Person A: I think we should build a website/);
  assert.match(transcript, /Person B: I agree; add student registration/);
  assert.match(transcript, /EXACT QUOTED MESSAGE \(message ID quoted-1\): Person A/);
});

test('conversation prompt combines current message, quoted message and shared group discussion', () => {
  const prompt = buildConversationAwarePrompt({ message: 'Can you build it?', quotedMessage: 'I think we should build a website.', groupHistory: 'Person B: Include registration.' });
  assert.match(prompt, /Can you build it/);
  assert.match(prompt, /MESSAGE BEING REPLIED TO/);
  assert.match(prompt, /Person B: Include registration/);
});

test('group transcript safely handles empty input', () => {
  assert.equal(formatGroupTranscript([]), '');
  assert.deepEqual(unwrapGroupMessage(null), {});
});
