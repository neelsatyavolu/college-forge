import { createHash, randomBytes } from "node:crypto";

export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";
export const CODEX_AUTH_BASE = "https://auth.openai.com";
export const CODEX_BACKEND_BASE = "https://chatgpt.com/backend-api/codex";

const SCOPE = "openid profile email offline_access";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generatePkce(): { verifier: string; challenge: string; state: string } {
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(32));
  return { verifier, challenge, state };
}

export function buildAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CODEX_CLIENT_ID,
    redirect_uri: CODEX_REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "codex_cli_rs",
  });
  return `${CODEX_AUTH_BASE}/oauth/authorize?${params.toString()}`;
}

export type CodexTokens = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresAt: number;
  accountId?: string;
};

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_in: number;
};

function decodeIdToken(idToken: string | undefined): { accountId?: string } {
  if (!idToken) return {};
  const parts = idToken.split(".");
  if (parts.length < 2) return {};
  try {
    const payload = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8"
    );
    const claims = JSON.parse(payload);
    const orgs = claims?.["https://api.openai.com/auth"]?.organizations;
    if (Array.isArray(orgs) && orgs.length > 0) {
      const personal = orgs.find((o: { is_default?: boolean }) => o?.is_default) ?? orgs[0];
      return { accountId: personal?.id };
    }
    return { accountId: claims?.sub };
  } catch {
    return {};
  }
}

async function postToken(body: URLSearchParams): Promise<CodexTokens> {
  const res = await fetch(`${CODEX_AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Codex token exchange failed (${res.status}): ${detail.slice(0, 400)}`);
  }
  const json = (await res.json()) as TokenResponse;
  const { accountId } = decodeIdToken(json.id_token);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    idToken: json.id_token,
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
    accountId,
  };
}

export function exchangeCode(code: string, verifier: string): Promise<CodexTokens> {
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: CODEX_REDIRECT_URI,
      client_id: CODEX_CLIENT_ID,
      code_verifier: verifier,
    })
  );
}

export function refreshTokens(refreshToken: string): Promise<CodexTokens> {
  return postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CODEX_CLIENT_ID,
      scope: SCOPE,
    })
  );
}
