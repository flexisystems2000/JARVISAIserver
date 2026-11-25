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
      const prompt = `You are JARVIS, a senior software engineer and multi-format project builder. Build the complete project requested, not merely a mock-up or a single-file demo. First infer the correct project type from the request: website, full-stack web app, API/backend, mobile app, desktop app, CLI, automation, library, script, data project, or document/file collection. Return ONLY valid JSON with keys name, description, projectType, files; files must be an array of {path,content}. Include every necessary source, configuration, documentation, test and asset file as text where practical. Use the framework and language the user requested; otherwise choose a mainstream, maintainable option and explain the choice in description. For websites, create complete responsive accessible UI and working interactions. For full-stack projects, include frontend, backend/API, data models, validation, error handling, and safe example configuration. For code projects, include a sensible entry point, dependency manifest, README and tests. For document/file tasks, create the requested file structure and formats rather than forcing index.html. Never invent credentials or embed secrets; use .env.example with placeholders only, and never create a real .env file. Do not claim code was executed, tested or deployed unless execution results are supplied. Keep paths relative and safe. Return up to 100 files and 8 MB total; prefer concise, complete files over omitting required components. Project name suggestion: ${String(projectName).slice(0,80)}. User requirements: ${String(request).slice(0,10000)}.`;
      return parseGeneratedProject(await askModel(prompt, { responseFormat: 'json' }));
    }
  };
}
module.exports = { createCodeGenerator, parseGeneratedProject };
