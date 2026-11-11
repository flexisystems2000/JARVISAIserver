# JARVIS deployment integrations

## Vercel website deployment
Set `VERCEL_TOKEN` in the JARVIS hosting provider's protected environment variables. Set `VERCEL_TEAM_ID` only when deploying under a Vercel team. Never paste tokens into WhatsApp or commit them to source control. Production deployments are approval-gated. JARVIS returns a `.vercel.app` URL only after the Vercel deployment reaches READY and the public URL responds successfully.

The direct file deployment path supports up to 100 text files, 1 MB per file and 8 MB total. Framework builds that require package installation, server-side functions, or build artifacts are not built by this direct upload path; deploy those through an appropriately linked Vercel Git integration or Vercel CLI workflow.

## GitHub
Set `GITHUB_TOKEN`, `GITHUB_OWNER`, and optionally `GITHUB_ALLOWED_REPOS`. Repository listing, tree inspection, file reading and code search are available to bot owners, configured system admins and current WhatsApp group admins. Repository writes/deletes remain approval-gated.

## General file generation service
Deploy the updated `python_services` app and install `python_services/requirements.txt`. The app mounts `/pdf/*` for existing PDF features and `/files/generate` for DOCX, XLSX, PPTX, CSV, TXT, Markdown, HTML, JSON, XML, YAML, CSS, JS, PY, PHP, JAVA, CPP, SQL, SVG and ZIP generation. Configure the same `PIPER_API_KEY` in both services.
