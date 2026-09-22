import { authorizeUrl, exchangeCode as exchange, generatePkce, parseCallback, providers, refreshTokens as refresh } from "@neelsatyavolu/shared-ai-auth";
import type { Tokens } from "@neelsatyavolu/shared-ai-auth";

export type GrokTokens = Tokens;
export const GROK_REDIRECT_URI = providers.grok.redirectUri;
export const GROK_API_BASE = process.env.GROK_API_BASE_URL ?? "https://api.x.ai/v1";
export const DEFAULT_GROK_MODEL = process.env.GROK_MODEL ?? "grok-4.6";

export const generateGrokPkce = generatePkce;
export function buildGrokAuthorizeUrl(challenge: string, state: string): string {
  return authorizeUrl("grok", { challenge, state });
}
export function extractGrokCodeAndState(input: string): { code: string | null; state: string | null } {
  const { code, state } = parseCallback(input);
  return { code, state };
}
export function exchangeGrokCode(code: string, verifier: string): Promise<GrokTokens> {
  return exchange("grok", code, verifier);
}
export function refreshGrokTokens(refreshToken: string): Promise<GrokTokens> {
  return refresh("grok", refreshToken);
}
