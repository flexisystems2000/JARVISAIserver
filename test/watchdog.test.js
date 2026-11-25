'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { containsLink, detectWatchdogViolation } = require('../agent/watchdog');

test('Watchdog detects HTTP and HTTPS links', () => {
  assert.equal(containsLink('Visit https://example.com/page'), true);
  assert.equal(containsLink('http://example.org'), true);
});

test('Watchdog detects www and bare-domain links', () => {
  assert.equal(containsLink('www.example.com'), true);
  assert.equal(containsLink('example.ng'), true);
});

test('Watchdog detects WhatsApp group invite links', () => {
  assert.equal(containsLink('chat.whatsapp.com/AbCd1234'), true);
});

test('Watchdog does not flag ordinary text without a link', () => {
  assert.equal(containsLink('Please send the lesson notes tomorrow.'), false);
  assert.deepEqual(detectWatchdogViolation('Good morning'), {
    isBadWord: false,
    isLink: false
  });
});
