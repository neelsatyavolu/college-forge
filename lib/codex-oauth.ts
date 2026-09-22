import { authorizeUrl, exchangeCode as exchange, generatePkce, providers, refreshTokens as refresh } from "@neelsatyavolu/shared-ai-auth";
import type { Tokens } from "@neelsatyavolu/shared-ai-auth";

export type CodexTokens = Tokens;
export const CODEX_BACKEND_BASE = "https://chatgpt.com/backend-api/codex";
export const CODEX_REDIRECT_URI = providers.codex.redirectUri;
export { generatePkce };

export function buildAuthorizeUrl(challenge: string, state: string): string {
  return authorizeUrl("codex", { challenge, state });
}

export function exchangeCode(code: string, verifier: string): Promise<CodexTokens> {
  return exchange("codex", code, verifier);
}

export function refreshTokens(refreshToken: string): Promise<CodexTokens> {
  return refresh("codex", refreshToken);
}
