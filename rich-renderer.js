'use strict';

const { randomUUID } = require('node:crypto');

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
          sourceCode: code.join('\n')
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

// Locate the native rich response for validation while preserving the
// complete composer-generated botForwardedMessage wrapper for transmission.
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
  if (!sock || typeof sock.sendMessage !== 'function') {
    throw new Error('The connected Baileys socket does not expose sendMessage().');
  }
  const blocks = parseMarkdownBlocks(markdown);
  if (!blocks.length) return null;

  // Use the documented richResponse sendMessage API. This avoids depending
  // on private composer paths that belonged to the previous Baileys fork.
  const baileys = await import('@itsliaaa/baileys');
  if (typeof baileys.tokenizeCode !== 'function') {
    throw new Error('@itsliaaa/baileys does not expose tokenizeCode(), required for rich code blocks.');
  }

  const richResponse = blocks.map(block => {
    if (block.messageType === TYPE.TEXT) {
      return { text: block.messageText };
    }
    if (block.messageType === TYPE.CODE) {
      return {
        language: block.codeMetadata.codeLanguage,
        code: baileys.tokenizeCode(
          block.codeMetadata.sourceCode,
          block.codeMetadata.codeLanguage
        )
      };
    }
    if (block.messageType === TYPE.TABLE) {
      return {
        title: block.tableMetadata.title,
        table: block.tableMetadata.rows.map(row => row.items)
      };
    }
    return { text: '' };
  }).filter(item => item.text || item.code || item.table);

  if (!richResponse.length) return null;
  await sock.sendPresenceUpdate?.('composing', jid);
  try {
    return await sock.sendMessage(
      jid,
      { richResponse, disclaimerText: 'Flexi Educational Consult' },
      quotedMessage ? { quoted: quotedMessage } : undefined
    );
  } finally {
    try { await sock.sendPresenceUpdate?.('paused', jid); } catch (_) {}
  }
}

module.exports = { parseMarkdownBlocks, sendRichReply, findRichResponse };
