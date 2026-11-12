# JARVIS deployment integrations

## Vercel website deployment
Set `VERCEL_TOKEN` in the JARVIS hosting provider's protected environment variables. Set `VERCEL_TEAM_ID` only when deploying under a Vercel team. Never paste tokens into WhatsApp or commit them to source control. Production deployments are approval-gated. JARVIS returns a `.vercel.app` URL only after the Vercel deployment reaches READY and the public URL responds successfully.

The direct file deployment path supports up to 100 files, 1 MB per file and 8 MB total. It does not run package installation or framework build commands. JARVIS rejects projects with framework build scripts/configuration rather than returning a misleading static deployment. Deploy Next.js, Vite, Nuxt, Astro, SvelteKit, Remix and similar projects through an appropriately linked Vercel Git integration or a Vercel CLI build/deploy workflow. `VERCEL_TEAM_ID` is the Vercel team ID (not the team display name); it is optional for personal-account deployments and must be set in the JARVIS host environment for team-scoped deployments. Reconnecting Vercel inside ChatGPT does not automatically configure Render's environment variables.

GitHub supports approval-gated repository creation (private by default) and approval-gated batch uploads of up to 100 files in one commit. Batch writes require GitHub Contents/Metadata write access (or the equivalent repository permission) on the target repository. `github_create_repository` requires the JARVIS owner and an approved action; organization creation additionally requires the token to have organization repository-creation permission.

## GitHub
Set `GITHUB_TOKEN`, `GITHUB_OWNER`, and optionally `GITHUB_ALLOWED_REPOS`. Repository listing, tree inspection, file reading and code search are available to bot owners, configured system admins and current WhatsApp group admins. Repository writes/deletes remain approval-gated.

## General file generation service
Deploy the updated `python_services` app and install `python_services/requirements.txt`. The app mounts `/pdf/*` for existing PDF features and `/files/generate` for DOCX, XLSX, PPTX, CSV, TXT, Markdown, HTML, JSON, XML, YAML, CSS, JS, PY, PHP, JAVA, CPP, SQL, SVG and ZIP generation. Configure the same `PIPER_API_KEY` in both services.
