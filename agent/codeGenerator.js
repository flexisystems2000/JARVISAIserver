'use strict';
const { parsePlan } = require('./brain');
function parseGeneratedProject(raw) {
  const parsed = parsePlan(raw);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.files)) throw new Error('Code generator did not return a project files array.');
  return {
    name: String(parsed.name || '').trim(),
    description: String(parsed.description || '').trim(),
    files: parsed.files.map(file => ({ path: file.path, content: file.content }))
  };
}
function createCodeGenerator({ askModel }) {
  if (typeof askModel !== 'function') throw new Error('Code generator requires an AI model adapter.');
  return {
    async generate({ request, projectName = '' }) {
      const prompt = `You are JARVIS Website Coding Agent. Generate a complete, responsive, production-ready STATIC website suitable for GitHub Pages. Return ONLY valid JSON with keys name, description, files; files is an array of {path,content}. Include index.html at repository root, plus separate CSS/JS/assets as useful. Use semantic accessible HTML, responsive CSS, working navigation and forms only when meaningful. Do not use backend APIs, secrets, environment files, external build tools, package installation, or server-side code. Use CDN libraries only when necessary. Do not claim deployment. Project name suggestion: ${String(projectName).slice(0,80)}. User requirements: ${String(request).slice(0,6000)}. Keep the complete output below 450KB total, no more than 30 files, and no individual file above 50KB.`;
      return parseGeneratedProject(await askModel(prompt, { responseFormat: 'json' }));
    }
  };
}
module.exports = { createCodeGenerator, parseGeneratedProject };
