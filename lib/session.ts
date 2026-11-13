import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { deleteDoc, readDoc, updateDoc, writeDoc } from "./doc-store";
import { getShare, putShare } from "./share-store";
import { copyWorkspace, getWorkspace, retireWorkspace } from "./store";

/**
 * Forge accounts are Xanom accounts. Each Xanom `sub` owns exactly one workspace; the signed `forge_session`
 * cookie carries both so every route can find the workspace without a storage read.
 */

export const SESSION_COOKIE = "forge_session";
const MAX_AGE_S = 60 * 60 * 24 * 180;

export type Session = { sub: string; workspaceId: string; email: string; name: string; exp: number };
export type Account = { sub: string; email: string; name: string; workspaceId: string; createdAt: number; lastSignIn: number };

function secret(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET is not set (32+ characters)");
  return Buffer.from(s);
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (body: string) => createHmac("sha256", secret()).update(`forge-session.${body}`).digest();

export function signSession(s: Omit<Session, "exp">, now = Date.now()): string {
  const body = b64(JSON.stringify({ ...s, exp: Math.floor(now / 1000) + MAX_AGE_S }));
  return `${body}.${b64(mac(body))}`;
}

export function readSession(value: string | undefined, now = Date.now()): Session | null {
  if (!value || value.length > 2000 || !process.env.SESSION_SECRET) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = mac(body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Session;
    if (typeof s.sub !== "string" || typeof s.workspaceId !== "string" || s.exp * 1000 < now) return null;
    return s;
  } catch {
    return null;
  }
}

export function sessionCookie(value: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; SameSite=Lax${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

const safe = (id: string) => {
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(id)) throw new Error("Invalid id");
  return id;
};
const accountKey = (sub: string) => `accounts/${safe(sub)}.json`;
const ownerKey = (workspaceId: string) => `workspace-owner/${safe(workspaceId)}.json`;

export const getAccount = (sub: string) => readDoc<Account>(accountKey(sub));

/**
 * Finds or creates the account for a Xanom user. A first sign-in brings along the browser's anonymous
 * workspace (so what someone did before signing in is kept) by moving it to a new id that only this
 * account's session can open. Share links follow it.
 */
export async function signInAccount(
  user: { sub: string; email: string; name: string },
  anonymousWorkspaceId: string | null,
  now = Date.now(),
): Promise<Account> {
  const existing = await getAccount(user.sub);
  if (existing?.workspaceId) return touchAccount(user, existing.workspaceId, now);
  const anon = anonymousWorkspaceId && /^[a-zA-Z0-9_-]{8,64}$/.test(anonymousWorkspaceId) ? anonymousWorkspaceId : null;
  if (anon) {
    // Claim the anonymous id first. If any account already owns it, it isn't anonymous: don't touch it.
    // A retry after a failure part way finds this claim (with the destination id) and resumes.
    const claim = await updateDoc<{ sub: string; movedTo?: string }>(ownerKey(anon), (cur) => cur ?? { sub: user.sub, movedTo: randomUUID() });
    if (claim.sub === user.sub && claim.movedTo) {
      const copied = await copyWorkspace(anon, claim.movedTo);
      if (copied) {
        await updateDoc<{ sub: string }>(ownerKey(claim.movedTo), (cur) => cur ?? { sub: user.sub });
        const account = await touchAccount(user, claim.movedTo, now);
        await moveShareLinks(claim.movedTo);
        await retireWorkspace(anon);
        return account;
      }
    }
  }
  const fresh = randomUUID();
  await updateDoc<{ sub: string }>(ownerKey(fresh), (cur) => cur ?? { sub: user.sub });
  return touchAccount(user, fresh, now);
}

/** Saves the account; an existing account keeps its workspace whatever is passed. */
function touchAccount(user: { sub: string; email: string; name: string }, workspaceId: string, now: number): Promise<Account> {
  return updateDoc<Account>(accountKey(user.sub), (cur) => ({
    sub: user.sub,
    email: user.email,
    name: user.name,
    workspaceId: cur?.workspaceId ?? workspaceId,
    createdAt: cur?.createdAt ?? now,
    lastSignIn: now,
  }));
}

async function moveShareLinks(workspaceId: string): Promise<void> {
  const ws = await getWorkspace(workspaceId);
  for (const meta of ws.shares || []) {
    const rec = await getShare(meta.token);
    if (rec) await putShare({ ...rec, workspaceId });
  }
}

/** Who owns a workspace (for the automatic-check sweep and summaries). */
export async function ownerOf(workspaceId: string): Promise<string | null> {
  return (await readDoc<{ sub: string }>(ownerKey(workspaceId)))?.sub ?? null;
}

const handoffKey = (token: string) => `handoff/${createHash("sha256").update(token).digest("hex")}.json`;

/**
 * One-time token that carries a forge.n3el.dev workspace cookie over to forge.xanom.co. The URL holds only
 * a random token; the workspace id stays in storage for two minutes.
 */
export async function createHandoff(workspaceId: string, now = Date.now()): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await writeDoc(handoffKey(token), { ws: workspaceId, exp: now + 120_000 });
  return token;
}

export async function claimHandoff(token: string, now = Date.now()): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  let ws: string | null = null;
  try {
    await updateDoc<{ ws: string; exp: number; used?: boolean }>(handoffKey(token), (cur) => {
      if (!cur || cur.used || cur.exp < now) throw new Error("expired");
      ws = cur.ws;
      return { ...cur, used: true };
    });
  } catch {
    return null;
  }
  await deleteDoc(handoffKey(token)).catch(() => undefined);
  return ws && /^[a-zA-Z0-9_-]{8,64}$/.test(ws) ? ws : null;
}
