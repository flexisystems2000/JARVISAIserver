'use strict';

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /(?:api[_-]?key|client[_-]?secret|password|access[_-]?token)\s*[:=]\s*["'][^"'\s]{12,}["']/i
];
const BLOCKED_FILES = /(^|\/)(?:\.env(?:\..*)?|\.git|id_rsa|id_ed25519|secrets?\.(?:json|ya?ml)|credentials?\.(?:json|ya?ml))$/i;

function validateProjectFiles(files, { maxFiles = 30, maxFileBytes = 50000, maxTotalBytes = 500000 } = {}) {
  if (!Array.isArray(files) || files.length < 1 || files.length > maxFiles) throw new Error(`Project must contain between 1 and ${maxFiles} files.`);
  const seen = new Set();
  let total = 0;
  const clean = files.map((file) => {
    const filePath = String(file?.path || '');
    const content = String(file?.content ?? '');
    if (!filePath || filePath.startsWith('/') || filePath.includes('\\') || filePath.startsWith('.github/workflows/') ||
        filePath.split('/').some(part => !part || part === '.' || part === '..') ||
        /[?#\0]/.test(filePath) || BLOCKED_FILES.test(filePath)) {
      throw new Error(`Unsafe or unsupported project path: ${filePath || '(empty)'}`);
    }
    if (seen.has(filePath)) throw new Error(`Duplicate project path: ${filePath}`);
    seen.add(filePath);
    if (Buffer.byteLength(content, 'utf8') > maxFileBytes) throw new Error(`File is too large: ${filePath}`);
    for (const pattern of SECRET_PATTERNS) if (pattern.test(content)) throw new Error(`Possible credential detected in ${filePath}; remove secrets before publishing.`);
    total += Buffer.byteLength(content, 'utf8');
    return { path: filePath, content };
  });
  if (total > maxTotalBytes) throw new Error('Generated project exceeds the total size limit.');
  if (!seen.has('index.html')) throw new Error('A static Vercel website must include a root index.html file.');
  return clean;
}
module.exports = { validateProjectFiles };
