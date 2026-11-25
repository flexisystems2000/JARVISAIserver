'use strict';

function unwrapGroupMessage(message) {
  let current = message;
  for (let i = 0; i < 6 && current && typeof current === 'object'; i++) {
    const key = Object.keys(current).find(name =>
      /^(ephemeralMessage|viewOnceMessage|viewOnceMessageV2|documentWithCaptionMessage|editedMessage)$/.test(name)
    );
    if (!key) break;
    current = current[key]?.message || current[key];
  }
  return current || {};
}

function extractGroupMessageText(message) {
  const value = unwrapGroupMessage(message);
  const text = value.conversation ||
    value.extendedTextMessage?.text ||
    value.imageMessage?.caption ||
    value.videoMessage?.caption ||
    value.documentMessage?.caption ||
    value.documentMessage?.fileName ||
    value.buttonsResponseMessage?.selectedDisplayText ||
    value.listResponseMessage?.title ||
    value.templateButtonReplyMessage?.selectedDisplayText ||
    '';
  return String(text || '').replace(/\u0000/g, '').trim().slice(0, 6000);
}

function formatGroupTranscript(messages, quotedMessage = null) {
  const lines = (Array.isArray(messages) ? messages : []).map(item => {
    const date = item.createdAt instanceof Date ? item.createdAt.toISOString() : new Date(item.createdAt || Date.now()).toISOString();
    return `[${date}] ${String(item.senderName || item.senderJid || 'Unknown participant')}: ${String(item.content || '').slice(0, 6000)}`;
  });
  if (quotedMessage) {
    lines.push('', `EXACT QUOTED MESSAGE (message ID ${quotedMessage.messageId}): ${quotedMessage.senderName || quotedMessage.senderJid}: ${quotedMessage.content}`);
  }
  return lines.join('\n').slice(-24000);
}

function buildConversationAwarePrompt({ message, quotedMessage, groupHistory } = {}) {
  return [
    String(message || ''),
    quotedMessage ? `\n\nMESSAGE BEING REPLIED TO (quoted by the sender):\n${quotedMessage}` : '',
    groupHistory ? `\n\nRECENT SHARED GROUP DISCUSSION (messages from all participants; newest discussion context):\n${groupHistory}` : ''
  ].join('');
}

module.exports = { unwrapGroupMessage, extractGroupMessageText, formatGroupTranscript, buildConversationAwarePrompt };
