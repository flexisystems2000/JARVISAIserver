'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
const axiosStub = { get: async () => ({ data: { data: { question: 'What is 2 + 2?', option: { a: '3', b: '4', c: '5', d: '6' }, answer: 'B', solution: 'Two plus two equals four.' } } }) };
Module._load = function(request, parent, isMain) { if (request === 'axios') return axiosStub; return originalLoad.call(this, request, parent, isMain); };
const quiz = require('../quizEngine');
Module._load = originalLoad;

test('ALOC poll quiz sends a native poll, closes after tally, explains and advances without scoring', async () => {
  const oldToken = process.env.ALOC_TOKEN;
  const oldMode = process.env.QUIZ_MODE;
  process.env.ALOC_TOKEN = 'test-token';
  process.env.QUIZ_MODE = 'poll';
  axiosStub.get = async () => ({ data: { data: { question: 'What is 2 + 2?', option: { a: '3', b: '4', c: '5', d: '6' }, answer: 'B', solution: 'Two plus two equals four.' } } });
  const sent = [];
  let id = 0;
  const sock = { user: { id: '2340000000000@s.whatsapp.net' }, sendMessage: async (jid, content) => {
    sent.push({ jid, content });
    return { key: { remoteJid: jid, id: `poll-${++id}` }, message: { pollCreationMessage: content.poll || null } };
  }};
  const group = '120363000000000000@g.us';
  try {
    quiz.configurePollQuiz({
      aggregateVotes: () => [{ name: 'B. 4', voters: ['voter-1'] }],
      explainAnswer: async () => 'Four is the sum of two and two.'
    });
    const result = await quiz.fireQuiz(sock, { subject: 'Mathematics', groupJid: group });
    assert.equal(result.mode, 'poll');
    const pollMessage = sent.find(x => x.content.poll);
    assert.ok(pollMessage);
    assert.equal(pollMessage.content.poll.selectableCount, 1);
    assert.equal(pollMessage.content.poll.values.length, 4);
    const active = quiz.getActiveQuiz(group);
    assert.ok(quiz.getPollCreationMessage(active.pollMessageKey));
    await quiz.handlePollUpdates(sock, [{ key: active.pollMessageKey, update: { pollUpdates: [
      { pollUpdateMessageKey: { id: 'vote-1', participant: '2341111111111@s.whatsapp.net' }, vote: { selectedOptions: ['A'] } },
      { pollUpdateMessageKey: { id: 'vote-2', participant: '2341111111111@s.whatsapp.net' }, vote: { selectedOptions: ['B'] } }
    ] } }]);
    assert.equal(quiz.getActiveQuiz(group).pollUpdates.length, 1, "latest vote replaces the same participant's previous vote");
    await quiz.closePollQuestion(sock, group);
    assert.ok(sent.some(x => x.content.text?.includes('Correct answer: B')));
    assert.ok(sent.some(x => x.content.text?.includes('Four is the sum')));
    assert.ok(sent.filter(x => x.content.poll).length >= 2, 'next poll should start automatically');
    assert.equal(Object.prototype.hasOwnProperty.call(quiz, 'scores'), false, 'quiz engine must not expose student score storage');
  } finally {
    quiz.stopQuiz(group);
    quiz.configurePollQuiz({});
    if (oldToken === undefined) delete process.env.ALOC_TOKEN; else process.env.ALOC_TOKEN = oldToken;
    if (oldMode === undefined) delete process.env.QUIZ_MODE; else process.env.QUIZ_MODE = oldMode;
  }
});


test('stopping one active poll quiz cancels it without stopping another group', async () => {
  const oldToken = process.env.ALOC_TOKEN;
  const oldMode = process.env.QUIZ_MODE;
  process.env.ALOC_TOKEN = 'test-token';
  process.env.QUIZ_MODE = 'poll';
  axiosStub.get = async () => ({ data: { data: { question: 'What is 2 + 2?', option: { a: '3', b: '4', c: '5', d: '6' }, answer: 'B', solution: 'Two plus two equals four.' } } });
  const sock = { user: { id: '2340000000000@s.whatsapp.net' }, sendMessage: async (jid, content) => ({
    key: { remoteJid: jid, id: `${jid}-${Date.now()}-${Math.random()}` },
    message: { pollCreationMessage: content.poll || null }
  }) };
  const groupA = '120363000000000001@g.us';
  const groupB = '120363000000000002@g.us';
  try {
    await quiz.fireQuiz(sock, { subject: 'Mathematics', groupJid: groupA });
    await quiz.fireQuiz(sock, { subject: 'English', groupJid: groupB });
    assert.ok(quiz.getActiveQuiz(groupA));
    assert.ok(quiz.getActiveQuiz(groupB));
    quiz.stopQuiz(groupA);
    assert.equal(quiz.getActiveQuiz(groupA), null);
    assert.ok(quiz.getActiveQuiz(groupB), 'the other group quiz should remain active');
  } finally {
    quiz.stopQuiz();
    if (oldToken === undefined) delete process.env.ALOC_TOKEN; else process.env.ALOC_TOKEN = oldToken;
    if (oldMode === undefined) delete process.env.QUIZ_MODE; else process.env.QUIZ_MODE = oldMode;
  }
});
