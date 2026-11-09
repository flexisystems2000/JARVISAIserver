'use strict';

const DEFAULT_BAD_WORDS = Object.freeze([
  'rubbish', 'mumu', 'foolish', 'stupid', 'bastard', 'ode'
]);

function containsBlockedWord(value, words = DEFAULT_BAD_WORDS) {
  const text = String(value || '').normalize('NFKC');
  return words.some(word => {
    const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text);
  });
}

function containsLink(value) {
  const text = String(value || '').normalize('NFKC');
  return /(?:https?:\/\/|www\.)[^\s]+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ng|edu|gov|co|app|dev|ai)\b(?:\/[^\s]*)?/i.test(text)
    || /\bchat\.whatsapp\.com\/[a-z0-9]+/i.test(text);
}

function detectWatchdogViolation(value, words = DEFAULT_BAD_WORDS) {
  return { isBadWord: containsBlockedWord(value, words), isLink: containsLink(value) };
}

module.exports = { DEFAULT_BAD_WORDS, containsBlockedWord, containsLink, detectWatchdogViolation };
