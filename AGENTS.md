# Forge agent notes

## This repo is public and open source (MIT)

Every commit is world-readable at github.com/neelsatyavolu/college-forge and cannot be taken back once pushed, while the production app at forge.n3el.dev stays live with real students' workspaces. Be more careful than in a private repo:

- Never commit secrets, tokens, `.env*` files (except the empty `.env.example`), `data/`, `.agmux/`, `.claude/`, logs, screenshots, transcripts or student details. Test workspaces must be synthetic. Run `gitleaks git .` before pushing.
- Treat every change as attacker-visible: keep workspace, share-token and recovery-code checks intact, validate input at the boundary, and never return internal error text to clients.
- Server `fetch` calls must target fixed or validated hosts; never build URLs from user input without checking them.
- Keep `.github/workflows` least-privilege: no `pull_request_target`, explicit `permissions`, and inputs passed through `env:`.

## AI providers

For Codex/Grok OAuth and model lists, use the public [shared-ai-auth](https://github.com/neelsatyavolu/shared-ai-auth) helper. `lib/codex-oauth.ts` and `lib/grok-oauth.ts` are thin app adapters; session cookies and web callback routes remain here. The live list comes from the helper's `models.json`, with the project blacklist in `lib/ai-models.ts`. Add a model to that blacklist only when Forge should hide it; new catalog models show by default. Never log tokens or pasted callback URLs.
