import { createHash, randomBytes, randomUUID } from "node:crypto";
import { deleteDoc, readDoc, updateDoc, writeDoc } from "./doc-store";

/**
 * Parent and counselor accounts. A student invites a parent or a college counselor by email and picks how
 * much they see (a level). They accept with their own Xanom account and then see the student's dashboard on
 * the web and in the iPhone app. Parents only read; counselors can also leave notes (app/api/parent/[id]).
 * The student can change the level or remove them at any time. A link without a role is a parent's.
 *
 * Storage (doc-store):
 *  - parents/<workspaceId>.json       the student's list of parent links: the source of truth for access
 *  - parent-invites/<sha256>.json     an unused invite; the URL carries the random token, never stored
 *  - parent-of/<parent sub>.json      the students a parent follows (an index; every read is re-checked
 *                                     against the student's own list, so a stale entry grants nothing)
 */

export const PARENT_LEVELS = ["basic", "standard", "full"] as const;
export type ParentLevel = (typeof PARENT_LEVELS)[number];

export const isParentLevel = (v: unknown): v is ParentLevel => typeof v === "string" && (PARENT_LEVELS as readonly string[]).includes(v);

export const FOLLOWER_ROLES = ["parent", "counselor"] as const;
export type FollowerRole = (typeof FOLLOWER_ROLES)[number];
export const isFollowerRole = (v: unknown): v is FollowerRole => typeof v === "string" && (FOLLOWER_ROLES as readonly string[]).includes(v);

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_PARENTS = 6;
export const MAX_COUNSELORS = 3;
const MAX_OF: Record<FollowerRole, number> = { parent: MAX_PARENTS, counselor: MAX_COUNSELORS };

export type ParentLink = {
  id: string;
  /** The address the student typed. */
  email: string;
  /** Absent on links made before counselors existed: those are parents. */
  role?: FollowerRole;
  level: ParentLevel;
  status: "invited" | "active";
  invitedAt: number;
  inviteHash?: string;
  inviteExp?: number;
  acceptedAt?: number;
  parentSub?: string;
  parentName?: string;
  /** The Xanom account that accepted (the invited address). */
  parentEmail?: string;
};

/** What the student's own apps get: no invite hash or parent account id. */
export type PublicParentLink = Omit<ParentLink, "inviteHash" | "parentSub"> & { expired?: boolean };

type ParentList = { links: ParentLink[] };
type Invite = { workspaceId: string; linkId: string; exp: number };
type ParentOf = { students: { linkId: string; workspaceId: string }[] };

export class ParentError extends Error {}

export const roleOf = (link: Pick<ParentLink, "role">): FollowerRole => (link.role === "counselor" ? "counselor" : "parent");

const ID = /^[A-Za-z0-9_-]{4,80}$/;
const safe = (id: string) => {
  if (!ID.test(id)) throw new ParentError("Invalid id.");
  return id;
};
const listKey = (workspaceId: string) => `parents/${safe(workspaceId)}.json`;
const ofKey = (sub: string) => `parent-of/${safe(sub)}.json`;
const hashToken = (token: string) => createHash("sha256").update(`forge-parent-invite.${token}`).digest("hex");
const inviteKey = (hash: string) => `parent-invites/${hash}.json`;

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

export function publicLink(link: ParentLink, now = Date.now()): PublicParentLink {
  const { inviteHash: _h, parentSub: _s, ...base } = link;
  const rest = { ...base, role: roleOf(link) };
  return link.status === "invited" && (link.inviteExp ?? 0) < now ? { ...rest, expired: true } : rest;
}

async function readList(workspaceId: string): Promise<ParentLink[]> {
  return (await readDoc<ParentList>(listKey(workspaceId)))?.links ?? [];
}

export async function listParents(workspaceId: string, now = Date.now()): Promise<PublicParentLink[]> {
  return (await readList(workspaceId)).map((l) => publicLink(l, now));
}

/** Writes a fresh invite token for a link. Returns the token for the URL. */
async function issueInvite(workspaceId: string, linkId: string, now: number): Promise<{ token: string; hash: string; exp: number }> {
  const token = randomBytes(24).toString("base64url");
  const hash = hashToken(token);
  const exp = now + INVITE_TTL_MS;
  await writeDoc(inviteKey(hash), { workspaceId, linkId, exp } satisfies Invite);
  return { token, hash, exp };
}

/**
 * Invites a parent, or sends a new invite to an address already invited (the old link stops working).
 * An address that already accepted keeps its access; change its level instead.
 */
export async function inviteParent(
  workspaceId: string,
  input: { email: string; level: ParentLevel; role?: FollowerRole },
  now = Date.now(),
): Promise<{ link: PublicParentLink; token: string }> {
  const role = input.role ?? "parent";
  const taken = `${role === "counselor" ? "That counselor" : "That parent"} already has access. Change their level instead.`;
  const existing = (await readList(workspaceId)).find((l) => l.email === input.email);
  if (existing?.status === "active") throw new ParentError(existing && roleOf(existing) === role ? taken : "That email already follows you. Remove it first to change its role.");
  const linkId = existing?.id ?? randomUUID();
  const { token, hash, exp } = await issueInvite(workspaceId, linkId, now);
  let oldHash: string | undefined;
  const saved = await updateDoc<ParentList>(listKey(workspaceId), (cur) => {
    const links = cur?.links ?? [];
    const prior = links.find((l) => l.id === linkId);
    oldHash = prior?.inviteHash;
    if (!prior && links.some((l) => l.email === input.email)) throw new ParentError("That email was just invited. Refresh to see it.");
    if (links.filter((l) => l.id !== linkId && roleOf(l) === role).length >= MAX_OF[role]) {
      throw new ParentError(`You can invite up to ${MAX_OF[role]} ${role === "counselor" ? "counselors" : "parents"}.`);
    }
    if (prior?.status === "active") throw new ParentError(taken);
    const link: ParentLink = { id: linkId, email: input.email, role, level: input.level, status: "invited", invitedAt: now, inviteHash: hash, inviteExp: exp };
    return { links: prior ? links.map((l) => (l.id === linkId ? link : l)) : [...links, link] };
  }).catch(async (err) => {
    await deleteDoc(inviteKey(hash)).catch(() => undefined);
    throw err;
  });
  if (oldHash && oldHash !== hash) await deleteDoc(inviteKey(oldHash)).catch(() => undefined);
  return { link: publicLink(saved.links.find((l) => l.id === linkId)!, now), token };
}

export async function setParentLevel(workspaceId: string, linkId: string, level: ParentLevel): Promise<PublicParentLink[]> {
  const saved = await updateDoc<ParentList>(listKey(workspaceId), (cur) => {
    const links = cur?.links ?? [];
    if (!links.some((l) => l.id === linkId)) throw new ParentError("That parent isn't on your list.");
    return { links: links.map((l) => (l.id === linkId ? { ...l, level } : l)) };
  });
  return saved.links.map((l) => publicLink(l));
}

/** Ends a parent's access (or cancels an invite) right away. */
export async function removeParent(workspaceId: string, linkId: string): Promise<PublicParentLink[]> {
  let removed: ParentLink | undefined;
  const saved = await updateDoc<ParentList>(listKey(workspaceId), (cur) => {
    const links = cur?.links ?? [];
    removed = links.find((l) => l.id === linkId);
    return { links: links.filter((l) => l.id !== linkId) };
  });
  if (removed) await forget(workspaceId, removed);
  return saved.links.map((l) => publicLink(l));
}

/** A workspace reset ends every parent's access, like it ends share links. */
export async function removeAllParents(workspaceId: string): Promise<void> {
  const links = await readList(workspaceId);
  await deleteDoc(listKey(workspaceId));
  await Promise.all(links.map((l) => forget(workspaceId, l)));
}

async function forget(workspaceId: string, link: ParentLink): Promise<void> {
  if (link.inviteHash) await deleteDoc(inviteKey(link.inviteHash)).catch(() => undefined);
  if (link.parentSub) {
    await updateDoc<ParentOf>(ofKey(link.parentSub), (cur) => ({
      students: (cur?.students ?? []).filter((s) => !(s.linkId === link.id && s.workspaceId === workspaceId)),
    })).catch(() => undefined);
  }
}

/** The invite behind a token, if it can still be accepted. */
export async function readInvite(token: string, now = Date.now()): Promise<{ workspaceId: string; link: ParentLink } | null> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const hash = hashToken(token);
  const invite = await readDoc<Invite>(inviteKey(hash));
  if (!invite || invite.exp < now || !ID.test(invite.workspaceId)) return null;
  const link = (await readList(invite.workspaceId)).find((l) => l.id === invite.linkId);
  if (!link || link.status !== "invited" || link.inviteHash !== hash) return null;
  return { workspaceId: invite.workspaceId, link };
}

/**
 * The parent accepts with their own account, signed in with the address the student invited (so a forwarded
 * link grants nothing). One use: the invite is gone afterwards. `studentSub` is the workspace's owner, so a
 * student can't accept their own invite.
 */
export async function acceptInvite(
  token: string,
  parent: { sub: string; email: string; name: string },
  studentSub: string | null,
  now = Date.now(),
): Promise<{ linkId: string; workspaceId: string }> {
  const found = await readInvite(token, now);
  if (!found) throw new ParentError("This invite has expired or was already used. Ask your student to send a new one.");
  if (studentSub && studentSub === parent.sub) throw new ParentError(`This invite is for your ${roleOf(found.link)}. Sign in with their own account.`);
  const { workspaceId, link } = found;
  if (!sameEmail(parent.email, link.email)) throw new ParentError(wrongAccount(link.email));
  // The index first: alone it grants nothing (every read re-checks the student's list), and if activation
  // then fails the parent can simply open the link again.
  await updateDoc<ParentOf>(ofKey(parent.sub), (cur) => {
    const students = (cur?.students ?? []).filter((s) => s.linkId !== link.id);
    return { students: [...students, { linkId: link.id, workspaceId }] };
  });
  await updateDoc<ParentList>(listKey(workspaceId), (cur) => {
    const links = cur?.links ?? [];
    const current = links.find((l) => l.id === link.id);
    if (!current || current.status !== "invited" || current.inviteHash !== link.inviteHash) {
      throw new ParentError("This invite has expired or was already used. Ask your student to send a new one.");
    }
    if (links.some((l) => l.id !== link.id && l.status === "active" && l.parentSub === parent.sub)) {
      throw new ParentError("You already follow this student.");
    }
    const accepted: ParentLink = {
      id: current.id, email: current.email, role: roleOf(current), level: current.level, status: "active", invitedAt: current.invitedAt,
      acceptedAt: now, parentSub: parent.sub, parentName: parent.name.slice(0, 80), parentEmail: parent.email.slice(0, 254),
    };
    return { links: links.map((l) => (l.id === link.id ? accepted : l)) };
  });
  if (link.inviteHash) await deleteDoc(inviteKey(link.inviteHash)).catch(() => undefined);
  return { linkId: link.id, workspaceId };
}

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Names the invited address only partly: the page is shown to whoever holds the link. */
export function wrongAccount(invited: string): string {
  const [user = "", domain = ""] = invited.split("@");
  const hint = `${user.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(6, user.length - 1)))}@${domain}`;
  return `This invite was sent to ${hint}. Sign in with that email, or ask your student to invite the email you use.`;
}

/** The students a parent can see now, each re-checked against the student's own list. */
export type Access = { linkId: string; workspaceId: string; level: ParentLevel; role: FollowerRole; name: string };

export async function studentsOf(sub: string): Promise<Access[]> {
  if (!ID.test(sub)) return [];
  const index = (await readDoc<ParentOf>(ofKey(sub)))?.students ?? [];
  const checked = await Promise.all(index.map((s) => accessFor(sub, s.linkId, s.workspaceId)));
  return checked.filter((s): s is NonNullable<typeof s> => !!s);
}

async function accessFor(sub: string, linkId: string, workspaceId: string): Promise<Access | null> {
  if (!ID.test(workspaceId)) return null;
  const link = (await readList(workspaceId)).find((l) => l.id === linkId);
  return link && link.status === "active" && link.parentSub === sub
    ? { linkId, workspaceId, level: link.level, role: roleOf(link), name: link.parentName || "" }
    : null;
}

/** One student a parent follows, by link id (what the parent's apps use; workspace ids never leave the server). */
export async function parentAccess(sub: string, linkId: string): Promise<Access | null> {
  if (!ID.test(sub) || !ID.test(linkId)) return null;
  const entry = ((await readDoc<ParentOf>(ofKey(sub)))?.students ?? []).find((s) => s.linkId === linkId);
  if (!entry) return null;
  return accessFor(sub, linkId, entry.workspaceId);
}
