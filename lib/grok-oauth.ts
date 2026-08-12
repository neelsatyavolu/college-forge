import { createHash, randomBytes } from "node:crypto";

export const GROK_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const GROK_REDIRECT_URI = "http://127.0.0.1:56121/callback";
export const GROK_AUTH_BASE = "https://auth.x.ai";
export const GROK_API_BASE = process.env.GROK_API_BASE_URL ?? "https://api.x.ai/v1";

const SCOPE = "openid profile email offline_access grok-cli:access api:access";

export const GROK_MODELS = [
  { id: "grok-4.6", label: "Grok 4.6", tier: "" },
  { id: "grok-4.3", label: "Grok 4.3", tier: "" },
] as const;
export const DEFAULT_GROK_MODEL = process.env.GROK_MODEL ?? "grok-4.6";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateGrokPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(32));
  return { verifier, challenge, state };
}

export function buildGrokAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: GROK_CLIENT_ID,
    redirect_uri: GROK_REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${GROK_AUTH_BASE}/oauth2/authorize?${params.toString()}`;
}

export function isKnownGrokModel(id: string): boolean {
  return GROK_MODELS.some((m) => m.id === id);
}

export function extractGrokCodeAndState(input: string): { code: string | null; state: string | null } {
  const trimmed = input.trim();
  if (!trimmed) return { code: null, state: null };

  try {
    if (trimmed.includes("://")) {
      const url = new URL(trimmed);
      return {
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state"),
      };
    }
    if (trimmed.startsWith("?") || /(?:^|[?&])(?:code|state)=/.test(trimmed)) {
      const params = new URLSearchParams(trimmed.replace(/^\?/, ""));
      return { code: params.get("code"), state: params.get("state") };
    }
  } catch {
    return { code: null, state: null };
  }

  return { code: trimmed, state: null };
}

export type GrokTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

async function postToken(body: URLSearchParams, fallbackRefreshToken?: string): Promise<GrokTokens> {
  const res = await fetch(`${GROK_AUTH_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Grok token exchange failed (${res.status}): ${detail.slice(0, 400)}`);
  }
  const json = (await res.json()) as TokenResponse;
  const refreshToken = json.refresh_token ?? fallbackRefreshToken;
  if (!refreshToken) throw new Error("Grok token response did not include a refresh token.");
  return {
    accessToken: json.access_token,
    refreshToken,
    expiresAt: Date.now() + (json.expires_in - 120) * 1000,
  };
}

export function exchangeGrokCode(code: string, verifier: string): Promise<GrokTokens> {
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: GROK_REDIRECT_URI,
      client_id: GROK_CLIENT_ID,
      code_verifier: verifier,
    })
  );
}

export function refreshGrokTokens(refreshToken: string): Promise<GrokTokens> {
  return postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: GROK_CLIENT_ID,
      scope: SCOPE,
    }),
    refreshToken
  );
}
