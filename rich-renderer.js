'use strict';

const {
  generateRichMessageContent,
  tokenizeCode
} = require('@innovatorssoft/baileys/lib/Utils/message-composer');

const TYPE = { TEXT: 2, TABLE: 4, CODE: 5 };

function parseMarkdownBlocks(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let text = [];
  const flushText = () => {
    const value = text.join('\n').trim();
    if (value) blocks.push({ messageType: TYPE.TEXT, messageText: value });
    text = [];
  };

  for (let i = 0; i < lines.length;) {
    const fence = lines[i].match(/^\s*```([\w.+-]*)\s*$/);
    if (fence) {
      flushText();
      const language = (fence[1] || 'text').toLowerCase();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({
        messageType: TYPE.CODE,
        codeMetadata: {
          codeLanguage: language,
          codeBlocks: tokenizeCode(code.join('\n'), language)
        }
      });
      continue;
    }

    if (i + 1 < lines.length && /^\s*\|?.+\|.+\|?\s*$/.test(lines[i]) &&
        /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      flushText();
      const splitRow = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
      const headers = splitRow(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      const width = headers.length;
      blocks.push({
        messageType: TYPE.TABLE,
        tableMetadata: {
          title: '',
          rows: [
            { items: headers, isHeading: true },
            ...rows.map(row => ({ items: Array.from({ length: width }, (_, n) => row[n] || '') }))
          ]
        }
      });
      continue;
    }

    if (!lines[i].trim()) { flushText(); i++; continue; }
    text.push(lines[i++]);
  }
  flushText();
  return blocks;
}

// The upstream composer currently nests richResponseMessage inside
// botForwardedMessage. Extract only the rich payload and relay it directly.
// This deliberately avoids fabricating or forwarding a media wrapper.
function findRichResponse(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Object.prototype.hasOwnProperty.call(value, 'richResponseMessage')) {
    return value.richResponseMessage;
  }
  for (const child of Object.values(value)) {
    const found = findRichResponse(child, seen);
    if (found) return found;
  }
  return null;
}

async function sendRichReply(sock, jid, markdown, quotedMessage = null) {
  if (!sock || typeof sock.relayMessage !== 'function') {
    throw new Error('The connected Baileys socket does not expose relayMessage().');
  }
  const submessages = parseMarkdownBlocks(markdown);
  if (!submessages.length) return null;

  const generated = generateRichMessageContent(
    submessages,
    quotedMessage,
    { useMarkdown: true, botJid: sock.user?.id }
  );
  const richPayload = findRichResponse(generated?.message);
  if (!richPayload) {
    throw new Error('Composer did not produce a richResponseMessage payload.');
  }

  // No botForwardedMessage wrapper: relay only the native rich response.
  const message = { richResponseMessage: richPayload };
  const messageId = generated.messageId;
  if (!messageId) throw new Error('Rich composer did not return a message ID.');

  await sock.sendPresenceUpdate?.('composing', jid);
  try {
    const result = await sock.relayMessage(jid, message, { messageId });
    return result || { key: { id: messageId } };
  } finally {
    try { await sock.sendPresenceUpdate?.('paused', jid); } catch (_) {}
  }
}

module.exports = { parseMarkdownBlocks, sendRichReply, findRichResponse };
