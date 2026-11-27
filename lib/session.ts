import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readDoc, updateDoc } from "./doc-store";
import { getShare, putShare } from "./share-store";
import { copyWorkspace, retireWorkspace, updateWorkspace } from "./store";
import { revokeFeed } from "./calendar-feed";

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
 * account's session can open. Its share links, calendar feed and recovery code do not: they end here.
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
        await revokeCarriedLinks(claim.movedTo, now);
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

/**
 * Anyone holding the anonymous workspace's share links, calendar feed or recovery code held an unowned workspace.
 * They must not follow it into the account, so the adopted copy starts with all of them ended.
 */
async function revokeCarriedLinks(workspaceId: string, now: number): Promise<void> {
  const ws = await updateWorkspace(workspaceId, (cur) => {
    const { recoveryCode: _r, ...rest } = cur;
    return { ...rest, shares: (cur.shares || []).map((s) => (s.revokedAt ? s : { ...s, revokedAt: now })) };
  });
  for (const meta of ws.shares) {
    const rec = await getShare(meta.token);
    if (rec && !rec.revokedAt) await putShare({ ...rec, revokedAt: now });
  }
  await revokeFeed(workspaceId);
}

/** Who owns a workspace (for the automatic-check sweep and summaries). */
export async function ownerOf(workspaceId: string): Promise<string | null> {
  return (await readDoc<{ sub: string }>(ownerKey(workspaceId)))?.sub ?? null;
}
