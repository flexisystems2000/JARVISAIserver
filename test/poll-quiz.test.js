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


test('ALOC Channel quiz publishes a native newsletter quiz without answer or solution follow-up', async () => {
  const oldToken = process.env.ALOC_TOKEN;
  process.env.ALOC_TOKEN = 'test-token';
  axiosStub.get = async () => ({
    data: { data: {
      question: 'What is 2 + 2?',
      option: { a: '3', b: '4', c: '5', d: '6' },
      answer: 'B',
      solution: 'Two plus two equals four.'
    } }
  });
  const sent = [];
  const sock = {
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
      return { key: { remoteJid: jid, id: 'channel-quiz-1' }, message: { pollCreationMessage: content.poll } };
    }
  };
  const channel = '120363421353629040@newsletter';
  try {
    const result = await quiz.fireChannelQuiz(sock, {
      subject: 'Mathematics',
      channelJid: channel
    });
    assert.equal(result.success, true);
    assert.equal(result.mode, 'channel-quiz');
    assert.equal(result.answerPublished, false);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].jid, channel);
    assert.equal(sent[0].content.poll.pollType, 1);
    assert.deepEqual(sent[0].content.poll.values, ['A. 3', 'B. 4', 'C. 5', 'D. 6']);
    assert.equal(sent[0].content.poll.correctAnswer, 'B. 4');
    assert.equal(sent[0].content.text, undefined);
    assert.equal(JSON.stringify(sent).includes('Two plus two equals four.'), false);
    assert.ok(quiz.getActiveChannelQuiz(channel));
    await quiz.advanceChannelQuiz(sock, channel);
    assert.equal(sent.length, 2, 'the next ALOC question should be published automatically');
    assert.equal(sent[1].content.poll.pollType, 1);
    assert.equal(sent.some(item => item.content.text), false, 'no answer-reveal text should be sent to the Channel');
    assert.equal(JSON.stringify(sent).includes('Two plus two equals four.'), false);
    quiz.stopChannelQuiz(channel);
    assert.equal(quiz.getActiveChannelQuiz(channel), null);
  } finally {
    quiz.stopChannelQuiz(channel);
    if (oldToken === undefined) delete process.env.ALOC_TOKEN; else process.env.ALOC_TOKEN = oldToken;
  }
});

test('Channel quiz rejects invalid newsletter JIDs and does not publish to a group', async () => {
  const oldToken = process.env.ALOC_TOKEN;
  process.env.ALOC_TOKEN = 'test-token';
  axiosStub.get = async () => ({ data: { data: {
    question: 'What is 2 + 2?',
    option: { a: '3', b: '4', c: '5', d: '6' },
    answer: 'B'
  } } });
  const sent = [];
  const sock = { sendMessage: async (jid, content) => { sent.push({ jid, content }); return {}; } };
  try {
    const result = await quiz.fireChannelQuiz(sock, { subject: 'Mathematics', channelJid: '120363000000000000@g.us' });
    assert.equal(result.success, false);
    assert.match(result.error, /Channel JID/i);
    assert.equal(sent.length, 0);
  } finally {
    if (oldToken === undefined) delete process.env.ALOC_TOKEN; else process.env.ALOC_TOKEN = oldToken;
  }
});
