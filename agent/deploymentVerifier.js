'use strict';
const axios = require('axios');
async function verifyPublicUrl(url, { attempts = 6, delayMs = 5000 } = {}) {
  if (!/^https:\/\/[a-z0-9.-]+\.github\.io(?:\/|$)/i.test(String(url || ''))) throw new Error('Refusing to verify an unexpected deployment URL.');
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await axios.get(url, { timeout: 12000, maxRedirects: 3, validateStatus: () => true });
      last = { status: response.status, reachable: response.status >= 200 && response.status < 400 };
      if (last.reachable) return { verified: true, url, status: response.status, attempts: attempt + 1 };
    } catch (error) { last = { reachable: false, error: error.code || error.message }; }
    if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return { verified: false, url, ...last, attempts };
}
module.exports = { verifyPublicUrl };
