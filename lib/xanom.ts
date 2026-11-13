// lib/xanom.ts — Xanom accounts client helper (spec v1). Depends only on `jose`.
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from "jose";

// Read lazily so builds and tests that never sign anyone in don't need the env vars.
const ISSUER = process.env.XANOM_ISSUER ?? "https://accounts.xanom.co";
const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const clientId = () => env("XANOM_CLIENT_ID");
const enc = new TextEncoder();
const secretKey = () => enc.encode(env("XANOM_CLIENT_SECRET")); // HS256 key: the client secret's raw UTF-8 bytes
// jose caches keys for the JWKS; cooldown/max age keep it at roughly the 10 min the spec asks for.
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/oauth/jwks`), { cacheMaxAge: 10 * 60 * 1000 });

export const FLOW_COOKIE = "xanom_flow";
export const FLOW_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 } as const;

export type Intent = "signin" | "link" | "convert";
export type Platform = "web" | "ios";
export type XanomUser = { sub: string; email: string; name: string };

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s: string) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));

/** Only same-site paths, so `return` can't send people off-site. */
function safeReturn(path: string | null | undefined): string {
  return path && path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/";
}

/**
 * GET /api/xanom/start. Returns the authorize URL to redirect to and the value for the
 * FLOW_COOKIE (set it with FLOW_COOKIE_OPTIONS). For intent "convert", pass the signed-in
 * user's email, name and whether *your app* verified that email.
 */
export async function startSignIn(opts: {
  redirectUri: string; // one of your registered callback URIs
  intent?: Intent;
  returnTo?: string;
  platform?: Platform;
  prompt?: "none" | "login";
  loginHint?: string;
  convert?: { email: string; name: string; emailVerified: boolean };
}): Promise<{ url: string; cookie: string }> {
  const intent = opts.intent ?? "signin";
  const state = random();
  const nonce = random();
  const verifier = random(48);
  const cookie = await new SignJWT({
    state, nonce, verifier, intent,
    returnTo: safeReturn(opts.returnTo),
    platform: opts.platform ?? "web",
    redirectUri: opts.redirectUri,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(`${clientId()}:xanom-flow`)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secretKey());

  const url = new URL(`${ISSUER}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    redirect_uri: opts.redirectUri,
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: await sha256(verifier),
    code_challenge_method: "S256",
  }).toString();
  if (opts.prompt) url.searchParams.set("prompt", opts.prompt);
  if (opts.loginHint) url.searchParams.set("login_hint", opts.loginHint);
  if (intent === "convert") {
    if (!opts.convert) throw new Error("intent=convert needs the current user's email and name");
    url.searchParams.set("convert", await createConvertTicket(opts.convert));
  }
  return { url: url.toString(), cookie };
}

/** Spec §3: HS256 compact JWS keyed with the client secret, 300 s lifetime, single-use jti. */
export function createConvertTicket(user: { email: string; name: string; emailVerified: boolean }): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: user.email, name: user.name, email_verified: user.emailVerified === true, jti: random(16) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(clientId())
    .setAudience(ISSUER)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 300)
    .sign(secretKey());
}

export class XanomError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

/**
 * GET /api/xanom/callback. Pass the request's query and the FLOW_COOKIE value; clear the
 * cookie afterwards either way. Returns the verified user plus what the flow was for.
 * Then apply the linking rules in SPEC.md §2 and start your normal session.
 */
export async function finishSignIn(
  query: URLSearchParams,
  cookie: string | undefined,
): Promise<{ user: XanomUser; intent: Intent; returnTo: string; platform: Platform }> {
  if (!cookie) throw new XanomError("no_flow", "sign-in cookie missing or expired");
  const { payload: flow } = await jwtVerify(cookie, secretKey(), { algorithms: ["HS256"], audience: `${clientId()}:xanom-flow` });
  const f = flow as JWTPayload & {
    state: string; nonce: string; verifier: string; intent: Intent; returnTo: string; platform: Platform; redirectUri: string;
  };
  if (query.get("state") !== f.state) throw new XanomError("bad_state");
  const error = query.get("error");
  if (error) throw new XanomError(error, query.get("error_description") ?? undefined);
  const code = query.get("code");
  if (!code) throw new XanomError("no_code");

  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${encodeURIComponent(clientId())}:${encodeURIComponent(env("XANOM_CLIENT_SECRET"))}`)}`,
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: f.redirectUri, code_verifier: f.verifier }),
  });
  const body = (await res.json()) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.id_token) throw new XanomError(body.error ?? "token_failed", body.error_description);

  const user = await verifyIdToken(body.id_token, f.nonce);
  return { user, intent: f.intent, returnTo: f.returnTo, platform: f.platform };
}

/** Checks signature (JWKS), iss, aud, exp and nonce. */
export async function verifyIdToken(idToken: string, nonce: string): Promise<XanomUser> {
  const { payload } = await jwtVerify(idToken, JWKS, { issuer: ISSUER, audience: clientId(), algorithms: ["RS256"] });
  if (payload.nonce !== nonce) throw new XanomError("bad_nonce");
  if (typeof payload.sub !== "string" || typeof payload.email !== "string") throw new XanomError("bad_id_token");
  return { sub: payload.sub, email: payload.email.toLowerCase(), name: String(payload.name ?? "") };
}

/**
 * GET /api/xanom/summary. Pass the Authorization header; returns the Xanom sub or null
 * (answer 401 on null). Look up the user by xanom_sub and reply per SPEC.md §4.
 */
export async function verifySummaryRequest(authorization: string | null | undefined): Promise<string | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(authorization.slice(7), JWKS, {
      issuer: ISSUER,
      audience: clientId(),
      algorithms: ["RS256"],
      maxTokenAge: "70s",
    });
    return payload.scope === "summary" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
