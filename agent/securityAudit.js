'use strict';
const SECRET_PATTERNS = [
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['GitHub token-like value', /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g],
  ['AWS access key ID', /\bAKIA[0-9A-Z]{16}\b/g],
  ['Google API key-like value', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ['Generic credential assignment', /(?:api[_-]?key|client[_-]?secret|password|access[_-]?token)\s*[:=]\s*["'][^"'\s]{12,}["']/gi]
];
const SKIP = /(^|\/)(node_modules|vendor|dist|build|\.git|coverage)(\/|$)/i;
const TEXT = /\.(?:js|jsx|ts|tsx|json|ya?ml|toml|env|ini|conf|config|py|go|java|php|rb|sh|md)$/i;
async function auditGitHubRepository(github, owner, repo, branch) {
  const tree = await github.getTree(owner, repo, branch);
  const candidates = tree.filter(x => x.type === 'blob' && !SKIP.test(x.path) && TEXT.test(x.path) && (x.size || 0) <= 250000).slice(0, 100);
  const findings = [];
  let scanned = 0;
  for (const file of candidates) {
    let content;
    try { content = await github.readFile(owner, repo, file.path, branch); } catch (_) { continue; }
    scanned++;
    for (const [kind, pattern] of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const before = content.slice(0, match.index);
        const line = before.split('\n').length;
        findings.push({ severity: 'high', type: kind, path: file.path, line, evidence: 'Potential secret value detected; value redacted.' });
        if (findings.length >= 100) break;
      }
      if (findings.length >= 100) break;
    }
    if (/\.env(?:\.|$)/i.test(file.path) && !/(^|\/)\.env\.example$/i.test(file.path)) {
      findings.push({ severity: 'medium', type: 'Environment file tracked', path: file.path, line: 1, evidence: 'A live environment file appears to be tracked in the repository.' });
    }
    if (findings.length >= 100) break;
  }
  return { repository: `${owner}/${repo}`, branch: branch || 'default', filesScanned: scanned, findings, limitations: ['Static pattern checks only; findings require human validation.', 'This audit does not exploit vulnerabilities, access deployed systems, or prove absence of secrets.', 'At most 100 eligible text files were inspected.'] };
}
module.exports = { auditGitHubRepository };
