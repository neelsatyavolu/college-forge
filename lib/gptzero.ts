/**
 * GPTZero's web-app API, used with the student's own GPTZero account (a server-side port of the gptzero CLI).
 * Every request goes to the one fixed host below; nothing from the request picks the URL. Logs never carry the
 * password, the session token, the essay text or GPTZero's response.
 */

export const GPTZERO_API = "https://api.gptzero.me";
const TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_FLAGGED = 60;

const HEADERS: Record<string, string> = {
  "content-type": "application/json",
  origin: "https://app.gptzero.me",
  referer: "https://app.gptzero.me/",
  "user-agent": "Mozilla/5.0 (compatible; Forge)",
  "x-gptzero-platform": "webapp",
  "x-page": "/",
};

/** `login`: GPTZero refused the email and password or the token. `quota`: rate or word limit. `upstream`: anything else. */
export type GptzeroErrorKind = "login" | "quota" | "upstream";

export class GptzeroError extends Error {
  constructor(readonly kind: GptzeroErrorKind, readonly status = 0) {
    super(`GPTZero ${kind}${status ? ` (${status})` : ""}`);
    this.name = "GptzeroError";
  }
}

const kindOf = (status: number): GptzeroErrorKind => (status === 401 || status === 403 ? "login" : status === 429 || status === 402 ? "quota" : "upstream");

async function post(path: "/v3/auth/signin-with-password" | "/v3/ai/text", body: unknown, token?: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(GPTZERO_API + path, {
      method: "POST",
      headers: token ? { ...HEADERS, authorization: `Bearer ${token}` } : HEADERS,
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new GptzeroError("upstream");
  }
  if (!res.ok) throw new GptzeroError(kindOf(res.status), res.status);
  if (Number(res.headers.get("content-length") || 0) > MAX_RESPONSE_BYTES) throw new GptzeroError("upstream", res.status);
  const text = await res.text().catch(() => "");
  if (text.length > MAX_RESPONSE_BYTES) throw new GptzeroError("upstream", res.status);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GptzeroError("upstream", res.status);
  }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

export type GptzeroSession = { token: string; expiresAt: number };

/** Signs in with email and password. `expiresAt` is in seconds, as GPTZero sends it. */
export async function signIn(email: string, password: string, nowSec = Date.now() / 1000): Promise<GptzeroSession> {
  const session = obj(obj(await post("/v3/auth/signin-with-password", { email, password })).session);
  const token = typeof session.access_token === "string" ? session.access_token : "";
  if (!token || token.length > 8192) throw new GptzeroError("login");
  const exp = typeof session.expires_at === "number" && Number.isFinite(session.expires_at) ? session.expires_at : nowSec + 3000;
  return { token, expiresAt: exp };
}

export async function scanText(token: string, text: string): Promise<unknown> {
  return post("/v3/ai/text", { document: text, multilingual: false, interpretability_required: false }, token);
}

export type Verdict = "ai" | "mixed" | "human";
export type ScanSummary = {
  verdict: Verdict | "unknown";
  confidence: string;
  ai: number;
  mixed: number;
  human: number;
  message: string;
  sentences: number;
  /** How many sentences GPTZero flagged; `flagged` holds at most MAX_FLAGGED of them. */
  flaggedCount: number;
  flagged: { sentence: string; prob: number }[];
  scanId: string;
  version: string;
};

/** GPTZero's response cut to what Forge shows, with every field type-checked (it's external data). */
export function summarize(raw: unknown): ScanSummary {
  const res = obj(raw);
  const doc = obj(Array.isArray(res.documents) ? res.documents[0] : undefined);
  const probs = obj(doc.class_probabilities);
  const cls = str(doc.predicted_class, 20).toLowerCase();
  const sentences = Array.isArray(doc.sentences) ? doc.sentences.map(obj) : [];
  const flagged = sentences.filter((s) => s.highlight_sentence_for_ai === true && typeof s.sentence === "string" && s.sentence.trim());
  return {
    verdict: cls === "ai" || cls === "mixed" || cls === "human" ? cls : "unknown",
    confidence: str(doc.confidence_category, 20),
    ai: num(probs.ai),
    mixed: num(probs.mixed),
    human: num(probs.human),
    message: str(doc.result_message, 400),
    sentences: sentences.length,
    flaggedCount: flagged.length,
    flagged: flagged
      .slice(0, MAX_FLAGGED)
      .map((s) => ({ sentence: str(s.sentence, 1000).trim(), prob: num(s.generated_prob) })),
    scanId: str(res.scanId, 100),
    version: str(doc.version, 60),
  };
}
