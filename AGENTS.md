# Forge agent notes

## This repo is public and open source (MIT)

Every commit is world-readable at github.com/neelsatyavolu/college-forge and cannot be taken back once pushed, while the production app at forge.n3el.dev stays live with real students' workspaces. Be more careful than in a private repo:

- Never commit secrets, tokens, `.env*` files (except the empty `.env.example`), `data/`, `.agmux/`, `.claude/`, logs, screenshots, transcripts or student details. Test workspaces must be synthetic. Run `gitleaks git .` before pushing.
- Treat every change as attacker-visible: keep workspace, share-token and recovery-code checks intact, validate input at the boundary, and never return internal error text to clients.
- Server `fetch` calls must target fixed or validated hosts; never build URLs from user input without checking them.
- Keep `.github/workflows` least-privilege: no `pull_request_target`, explicit `permissions`, and inputs passed through `env:`.

## AI providers

For Codex/Grok OAuth and model lists, use the public [shared-ai-auth](https://github.com/neelsatyavolu/shared-ai-auth) helper. `lib/codex-oauth.ts` and `lib/grok-oauth.ts` are thin app adapters; session cookies and web callback routes remain here. The live list comes from the helper's `models.json`, with the project blacklist in `lib/ai-models.ts`. Add a model to that blacklist only when Forge should hide it; new catalog models show by default. Never log tokens or pasted callback URLs.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
