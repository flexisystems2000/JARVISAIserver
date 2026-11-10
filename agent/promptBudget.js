'use strict';

function compactPromptAfter413(prompt) {
  const value = String(prompt || '');
  if (value.length <= 12000) return null;
  return `${value.slice(0, 6000)}\n\n[Earlier context compacted after HTTP 413]\n\n${value.slice(-14000)}`;
}

module.exports = { compactPromptAfter413 };
