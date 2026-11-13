'use strict';

const TYPE = Object.freeze({
  TEXT: 2,
  TABLE: 4,
  CODE: 5
});

const DISCLAIMER = 'Flexi Educational Consult';

const SUPPORTED_CODE_LANGUAGES = new Set([
  'css',
  'html',
  'javascript',
  'typescript',
  'python',
  'golang',
  'rust',
  'c',
  'c#',
  'c++',
  'bash',
  'bat',
  'powershell'
]);

const LANGUAGE_ALIASES = Object.freeze({
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  go: 'golang',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  htm: 'html',
  xml: 'html',
  cs: 'c#',
  csharp: 'c#',
  cpp: 'c++',
  cxx: 'c++'
});

function normalizeLanguage(language) {
  const requested = String(language || 'text')
    .trim()
    .toLowerCase();

  return LANGUAGE_ALIASES[requested] || requested;
}

function splitTableRow(line) {
  let value = String(line || '').trim();

  if (value.startsWith('|')) {
    value = value.slice(1);
  }

  if (value.endsWith('|') && !value.endsWith('\\|')) {
    value = value.slice(0, -1);
  }

  const cells = [];
  let cell = '';
  let escaped = false;

  for (const character of value) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }

  if (escaped) {
    cell += '\\';
  }

  cells.push(cell.trim());

  return cells;
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);

  return (
    cells.length > 1 &&
    cells.every(cell => /^:?-{3,}:?$/.test(cell))
  );
}

function parseMarkdownBlocks(markdown) {
  const lines = String(markdown || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  const blocks = [];
  let textLines = [];

  function flushText() {
    const value = textLines.join('\n').trim();

    if (value) {
      blocks.push({
        messageType: TYPE.TEXT,
        messageText: value
      });
    }

    textLines = [];
  }

  for (let i = 0; i < lines.length;) {
    // Markdown code blocks
    const fence = lines[i].match(/^\s*```([\w.+#-]*)\s*$/);

    if (fence) {
      flushText();

      const language = normalizeLanguage(fence[1] || 'text');
      const codeLines = [];

      i++;

      while (
        i < lines.length &&
        !/^\s*```\s*$/.test(lines[i])
      ) {
        codeLines.push(lines[i]);
        i++;
      }

      if (i < lines.length) {
        i++;
      }

      blocks.push({
        messageType: TYPE.CODE,
        codeMetadata: {
          codeLanguage: language,
          sourceCode: codeLines.join('\n')
        }
      });

      continue;
    }

    // Markdown tables
    if (
      i + 1 < lines.length &&
      lines[i].includes('|') &&
      isTableSeparator(lines[i + 1])
    ) {
      flushText();

      const headers = splitTableRow(lines[i]);

      i += 2;

      const rows = [{
        isHeading: true,
        items: headers
      }];

      while (
        i < lines.length &&
        lines[i].includes('|') &&
        lines[i].trim()
      ) {
        rows.push({
          isHeading: false,
          items: splitTableRow(lines[i])
        });

        i++;
      }

      const columnCount = headers.length;

      const normalizedRows = rows.map(row => ({
        isHeading: row.isHeading,

        items: Array.from(
          { length: columnCount },
          (_, columnIndex) => row.items[columnIndex] || ''
        )
      }));

      blocks.push({
        messageType: TYPE.TABLE,
        tableMetadata: {
          title: '',
          rows: normalizedRows
        }
      });

      continue;
    }

    if (!lines[i].trim()) {
      flushText();
      i++;
      continue;
    }

    textLines.push(lines[i]);
    i++;
  }

  flushText();

  return blocks;
}

function findRichResponse(value, seen = new Set()) {
  if (
    !value ||
    typeof value !== 'object' ||
    seen.has(value)
  ) {
    return null;
  }

  seen.add(value);

  if (
    Object.prototype.hasOwnProperty.call(
      value,
      'richResponseMessage'
    )
  ) {
    return value.richResponseMessage;
  }

  for (const child of Object.values(value)) {
    const found = findRichResponse(child, seen);

    if (found !== null) {
      return found;
    }
  }

  return null;
}

function normalizeTableRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => ({
    isHeading:
      typeof row?.isHeading === 'boolean'
        ? row.isHeading
        : index === 0,

    items: Array.isArray(row?.items)
      ? row.items.map(item => String(item ?? ''))
      : []
  }));
}

function toNativeTableRows(rows) {
  return normalizeTableRows(rows).map(row => row.items);
}

async function updatePresence(sock, jid, state) {
  try {
    await sock.sendPresenceUpdate?.(state, jid);
  } catch (_) {
    // Presence updates must not interrupt message delivery.
  }
}

async function sendRichResponse(sock, jid, richResponse, quotedMessage) {
  if (!richResponse.length) {
    return null;
  }

  await updatePresence(sock, jid, 'composing');

  try {
    return await sock.sendMessage(
      jid,
      {
        disclaimerText: DISCLAIMER,
        richResponse
      },
      quotedMessage
        ? { quoted: quotedMessage }
        : undefined
    );
  } finally {
    await updatePresence(sock, jid, 'paused');
  }
}

/**
 * Sends a native Itsliaaa table message.
 *
 * This deliberately uses Itsliaaa's dedicated table payload,
 * not a table nested inside richResponse.
 */
async function sendNativeTable(
  sock,
  jid,
  tableMetadata,
  quotedMessage
) {
  const rows = normalizeTableRows(tableMetadata.rows);

  if (!rows.length) {
    return null;
  }

  const table = toNativeTableRows(rows);

  await updatePresence(sock, jid, 'composing');

  try {
    return await sock.sendMessage(
      jid,
      {
        disclaimerText: DISCLAIMER,
        title: tableMetadata.title || '',
        table,
        noHeading: false
      },
      quotedMessage
        ? { quoted: quotedMessage }
        : undefined
    );
  } finally {
    await updatePresence(sock, jid, 'paused');
  }
}

async function sendRichReply(
  sock,
  jid,
  markdown,
  quotedMessage = null
) {
  if (!sock || typeof sock.sendMessage !== 'function') {
    throw new Error(
      'The connected Baileys socket does not expose sendMessage().'
    );
  }

  const blocks = parseMarkdownBlocks(markdown);

  if (!blocks.length) {
    return null;
  }

  // Itsliaaa is ESM, while this renderer remains CommonJS.
  const baileys = await import('@itsliaaa/baileys');

  const results = [];
  let richResponse = [];

  async function flushRichResponse() {
    if (!richResponse.length) {
      return;
    }

    const currentBatch = richResponse;
    richResponse = [];

    const result = await sendRichResponse(
      sock,
      jid,
      currentBatch,
      quotedMessage
    );

    results.push(result);
  }

  for (const block of blocks) {
    // Normal text
    if (block.messageType === TYPE.TEXT) {
      richResponse.push({
        text: block.messageText
      });

      continue;
    }

    // Code blocks
    if (block.messageType === TYPE.CODE) {
      const language = normalizeLanguage(
        block.codeMetadata.codeLanguage
      );

      const sourceCode = block.codeMetadata.sourceCode;

      if (SUPPORTED_CODE_LANGUAGES.has(language)) {
        if (typeof baileys.tokenizeCode !== 'function') {
          throw new Error(
            '@itsliaaa/baileys does not expose tokenizeCode().'
          );
        }

        richResponse.push({
          language,
          code: baileys.tokenizeCode(
            sourceCode,
            language
          )
        });
      } else {
        richResponse.push({
          text: `\`\`\`${language}\n${sourceCode}\n\`\`\``
        });
      }

      continue;
    }

    // Native standalone table
    if (block.messageType === TYPE.TABLE) {
      // Send preceding text/code before the table.
      await flushRichResponse();

      const result = await sendNativeTable(
        sock,
        jid,
        block.tableMetadata,
        quotedMessage
      );

      if (result) {
        results.push(result);
      }
    }
  }

  // Send any remaining text/code after the final table.
  await flushRichResponse();

  return results.length === 1
    ? results[0]
    : results;
}

module.exports = {
  parseMarkdownBlocks,
  sendRichReply,
  findRichResponse
};
