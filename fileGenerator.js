'use strict';

const path = require('path');

const CREATE_FILE_FORMATS = Object.freeze({
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8', yaml: 'text/yaml; charset=utf-8', yml: 'text/yaml; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', py: 'text/x-python; charset=utf-8',
  php: 'application/x-httpd-php; charset=utf-8', java: 'text/x-java-source; charset=utf-8', cpp: 'text/x-c++src; charset=utf-8',
  sql: 'application/sql; charset=utf-8', svg: 'image/svg+xml', zip: 'application/zip', rtf: 'application/rtf; charset=utf-8',
  ts: 'text/typescript; charset=utf-8', tsx: 'text/typescript; charset=utf-8', jsx: 'text/javascript; charset=utf-8',
  c: 'text/x-c; charset=utf-8', h: 'text/x-c; charset=utf-8', cs: 'text/plain; charset=utf-8', go: 'text/plain; charset=utf-8',
  rs: 'text/plain; charset=utf-8', rb: 'text/plain; charset=utf-8', sh: 'text/x-shellscript; charset=utf-8', ps1: 'text/plain; charset=utf-8',
  bat: 'text/plain; charset=utf-8', toml: 'application/toml; charset=utf-8', ini: 'text/plain; charset=utf-8', conf: 'text/plain; charset=utf-8',
  properties: 'text/plain; charset=utf-8', tex: 'application/x-tex; charset=utf-8', mdx: 'text/markdown; charset=utf-8', jsonl: 'application/x-ndjson; charset=utf-8'
});


function validateCreateFileRequest(request) {
  const value = String(request || '');
  const filenameCue = value.match(/(?:filename|file\s*name|save\s+as|named|call\s+it)\s*[:=]?\s*["']?([^\n"'`]+)/i);
  if (filenameCue) {
    const candidate = filenameCue[1].trim().split(/[\s,;]+/)[0];
    const extension = path.extname(candidate).slice(1).toLowerCase();
    if (extension && !Object.prototype.hasOwnProperty.call(CREATE_FILE_FORMATS, extension)) {
      throw new Error(`Unsupported file format: .${extension}. Supported formats include PDF, DOCX, XLSX, PPTX, CSV, TXT, Markdown, HTML, JSON, XML, YAML, CSS, JavaScript, Python, PHP, Java, C/C++, C#, Go, Rust, Ruby, shell scripts, SQL, SVG, RTF, TOML, INI, LaTeX, MDX, JSONL and ZIP.`);
    }
  }
  return true;
}

function inferCreateFileFormat(request) {
  const value = String(request || '');
  const extensions = [...value.matchAll(/\.([a-z0-9]{2,5})(?=$|[\s"'`),;])/ig)];
  for (const match of extensions.reverse()) {
    const extension = match[1].toLowerCase();
    if (Object.prototype.hasOwnProperty.call(CREATE_FILE_FORMATS, extension)) return extension;
  }
  const checks = [
    ['pptx', /\b(powerpoint|power point|presentation|slide deck|slides)\b/i],
    ['xml', /\bxml\b/i], ['yaml', /\b(yaml|yml)\b/i], ['css', /\bcss\b/i],
    ['js', /\b(javascript|js file|script file)\b/i], ['py', /\b(python|py file|python script)\b/i],
    ['php', /\bphp\b/i], ['java', /\bjava source|java file\b/i], ['cpp', /\b(c\+\+|cpp)\b/i],
    ['sql', /\bsql\b/i], ['svg', /\bsvg\b/i], ['zip', /\b(zip archive|zip file|compressed archive)\b/i], ['rtf', /\brtf\b|rich text/i],
    ['ts', /\btypescript\b/i], ['tsx', /\btsx\b/i], ['jsx', /\bjsx\b/i], ['c', /\bc source\b|\.c file/i], ['h', /\bc header\b|\.h file/i],
    ['cs', /\bc#|csharp\b/i], ['go', /\bgolang|go source\b/i], ['rs', /\brust source\b/i], ['rb', /\bruby source\b/i],
    ['sh', /\bshell script|bash script\b/i], ['ps1', /\bpowershell script\b/i], ['bat', /\bbatch file\b/i], ['toml', /\btoml\b/i],
    ['ini', /\bini file\b/i], ['conf', /\bconfiguration file\b/i], ['properties', /\bproperties file\b/i], ['tex', /\blatex|\.tex file\b/i],
    ['mdx', /\bmdx\b/i], ['jsonl', /\bjsonl|json lines\b/i],
    ['xlsx', /\b(excel|spreadsheet|workbook|xlsx)\b/i],
    ['docx', /\b(word document|word doc|microsoft word|word file|docx)\b/i],
    ['csv', /\b(csv|comma[ -]separated)\b/i],
    ['json', /\b(json|\.json)\b/i],
    ['html', /\b(html|web page|webpage|website source)\b/i],
    ['md', /\b(markdown|\.md)\b/i],
    ['txt', /\b(plain text|text file|\.txt)\b/i],
    ['pdf', /\b(pdf|\.pdf)\b/i]
  ];
  for (const [format, pattern] of checks) if (pattern.test(value)) return format;
  return 'pdf'; // Keep the historical !createfile default unchanged.
}

function extractCreateFileName(request) {
  const formats = Object.keys(CREATE_FILE_FORMATS).join('|');
  const named = String(request || '').match(new RegExp(`(?:filename|file\\s*name|save\\s+as|named|call\\s+it)\\s*[:=]?\\s*["']?([A-Za-z0-9][A-Za-z0-9 _.-]*\\.(?:${formats}))`, 'i'));
  if (named) return path.basename(named[1].trim());
  const any = String(request || '').match(new RegExp(`([A-Za-z0-9][A-Za-z0-9_-]*\\.(?:${formats}))`, 'i'));
  return any ? path.basename(any[1]) : '';
}

function deriveCreateFileTitle(request, explicitFilename = '') {
  let title = String(request || '')
    .replace(/^\s*!(?:createfile|create(?:\s+document)?|generate(?:\s+pdf)?)\s*/i, '')
    .replace(/^\s*(?:please\s+)?(?:create|generate|make|write)\s+(?:me\s+)?(?:an|a|the)?\s*/i, '')
    .replace(/(?:filename|file\s*name|save\s+as|named|call\s+it)\s*[:=]?\s*["']?[A-Za-z0-9][A-Za-z0-9 _.-]*\.(?:pdf|docx|xlsx|pptx|csv|txt|md|html|json|xml|yaml|yml|css|js|py|php|java|cpp|sql|svg|zip|rtf|ts|tsx|jsx|c|h|cs|go|rs|rb|sh|ps1|bat|toml|ini|conf|properties|tex|mdx|jsonl)/ig, '')
    .replace(/\b(?:pdf|docx|xlsx|pptx|csv|txt|md|html|json|xml|yaml|yml|css|js|py|php|java|cpp|sql|svg|zip|rtf|ts|tsx|jsx|c|h|cs|go|rs|rb|sh|ps1|bat|toml|ini|conf|properties|tex|mdx|jsonl|word document|word doc|word file|excel|spreadsheet|workbook|powerpoint|presentation|slide deck|slides|markdown|plain text|text file|file|document)\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s*(?:about|on|for|regarding)\s+/i, '')
    .replace(/^[\s:,-]+|[\s:,-]+$/g, '')
    .trim();
  if (explicitFilename) title = title || path.basename(explicitFilename, path.extname(explicitFilename));
  return (title || 'JARVIS Document').slice(0, 160);
}

function buildCreateFilePrompt(request, format, title) {
  const base = `Create the requested file content. Fulfil the user's actual purpose; do not assume it must be educational. Use accurate, well-organised material, useful examples or data where appropriate, and do not invent facts. Document title: ${title}. Return only the content required for the selected format, with no explanation about file creation.\n\nUSER REQUEST: ${request}`;
  if (format === 'json') return `${base}\n\nFORMAT RULE: Return only valid JSON (an object or array). No Markdown fences, comments, or surrounding prose.`;
  if (format === 'csv' || format === 'xlsx') return `${base}\n\nFORMAT RULE: Return only valid JSON tabular data. Prefer an array of objects with consistent keys, or an object shaped like {"headers":["Column A","Column B"],"rows":[["value",123]]}. For an Excel workbook with multiple sheets, use {"sheets":[{"name":"Sheet name","headers":[...],"rows":[...]}]}. Do not return Markdown or CSV fences.`;
  if (format === 'pptx') return `${base}\n\nFORMAT RULE: Return only valid JSON in this shape: {"slides":[{"title":"Slide title","bullets":["Point one","Point two"],"body":"Optional short supporting text"}]}. Create a logical presentation with a title slide and concise, presentation-ready slides. No Markdown fences or prose outside JSON.`;
  if (['xml','yaml','yml','css','js','py','php','java','cpp','sql','svg','ts','tsx','jsx','c','h','cs','go','rs','rb','sh','ps1','bat','toml','ini','conf','properties','tex','mdx','jsonl'].includes(format)) return `${base}\n\nFORMAT RULE: Return only valid ${format.toUpperCase()} source/content. Do not add Markdown fences or explanatory prose.`;
  if (format === 'rtf') return `${base}\n\nFORMAT RULE: Return clean plain text paragraphs. Do not use Markdown or RTF control words; the document service will format the content as RTF.`;
  if (format === 'zip') return `${base}\n\nFORMAT RULE: Return only valid JSON shaped as {\"files\":[{\"path\":\"relative/name.ext\",\"content\":\"file content\"}]}. Include a small useful collection of files. No Markdown fences.`;
  if (format === 'html') return `${base}\n\nFORMAT RULE: Return only an HTML body fragment using semantic headings, paragraphs, lists and tables as needed. Do not include scripts, event-handler attributes, forms, iframes, embeds, or external resources; the service will sanitise the markup.`;
  if (format === 'txt') return `${base}\n\nFORMAT RULE: Return clean plain text without Markdown formatting.`;
  if (format === 'md') return `${base}\n\nFORMAT RULE: Return well-structured Markdown with headings and lists where useful.`;
  return `${base}\n\nFORMAT RULE: Return a readable document using Markdown headings and lists. This content will be rendered as ${format.toUpperCase()}.`;
}

module.exports = {
  CREATE_FILE_FORMATS,
  validateCreateFileRequest,
  inferCreateFileFormat,
  extractCreateFileName,
  deriveCreateFileTitle,
  buildCreateFilePrompt
};
