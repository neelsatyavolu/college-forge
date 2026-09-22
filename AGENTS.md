# Forge agent notes

For Codex/Grok OAuth and model lists, use the public [shared-ai-auth](https://github.com/neelsatyavolu/shared-ai-auth) helper. `lib/codex-oauth.ts` and `lib/grok-oauth.ts` are thin app adapters; session cookies and web callback routes remain here. The live list comes from the helper's `models.json`, with the project blacklist in `lib/ai-models.ts`. Add a model to that blacklist only when Forge should hide it; new catalog models show by default. Never log tokens or pasted callback URLs.
