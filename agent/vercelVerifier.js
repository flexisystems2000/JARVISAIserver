'use strict';
const axios = require('axios');
async function verifyVercelUrl(url, { token, teamId, deploymentId } = {}) {
  if (!/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(String(url || ''))) throw new Error('Refusing to verify an unexpected Vercel deployment URL.');
  const params = teamId ? { teamId } : {};
  let state = 'UNKNOWN';
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const result = await axios.get(`https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}`, { timeout: 15000, params, headers: { Authorization: `Bearer ${token}` } });
      state = String(result.data?.readyState || result.data?.state || 'UNKNOWN').toUpperCase();
      if (state === 'READY') {
        const check = await axios.get(url, { timeout: 12000, maxRedirects: 3, validateStatus: () => true });
        if (check.status >= 200 && check.status < 400) return { verified: true, state, status: check.status };
      }
      if (['ERROR','CANCELED'].includes(state)) return { verified: false, state };
    } catch (error) { if (error.response?.status && error.response.status < 500) throw new Error(`Could not verify Vercel deployment: ${error.response.status}`); }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  return { verified: false, state };
}
module.exports = { verifyVercelUrl };
