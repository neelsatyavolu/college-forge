import { isRound, isStatus, newApp, type PortalResult, type RoundId, type StatusId, type TrackedApp } from "./tracker";
import type { PortalLogin } from "./portal-logins";

/**
 * Moves a College Apps account into Forge. College Apps encrypts everything in the browser with keys derived
 * from the account password, so the student gives that password once: this derives the same keys College Apps
 * does, signs in, reads and decrypts the vault, and signs out. The password is not stored or logged.
 */

const COLLEGEAPPS_URL = "https://collegeapps.n3el.dev";
const PBKDF2_ITERATIONS = 600_000;
const SALT_PREFIX = "collegeapps.n3el.dev/v1/";
const enc = new TextEncoder();

export class ImportError extends Error {}

async function deriveKeys(email: string, password: string): Promise<{ authKey: string; encKey: CryptoKey }> {
  const subtle = globalThis.crypto.subtle;
  const salt = await subtle.digest("SHA-256", enc.encode(SALT_PREFIX + email.trim().toLowerCase()));
  const pwKey = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const master = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, pwKey, 256);
  const hkdf = await subtle.importKey("raw", master, "HKDF", false, ["deriveBits", "deriveKey"]);
  const empty = new Uint8Array(0);
  const authBits = await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: empty, info: enc.encode("collegeapps auth") }, hkdf, 256);
  const encKey = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: empty, info: enc.encode("collegeapps vault") },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  return { authKey: Buffer.from(authBits).toString("hex"), encKey };
}

async function decryptVault(blob: string, key: CryptoKey): Promise<unknown> {
  const [version, iv, ct] = blob.split(".");
  if (version !== "v1" || !iv || !ct) throw new ImportError("College Apps sent data in a format Forge doesn't know.");
  try {
    const plain = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(iv, "base64") }, key, Buffer.from(ct, "base64"));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new ImportError("Couldn't unlock your College Apps data with that password.");
  }
}

type CaLogin = { url?: string; username?: string; password?: string };
type CaApp = {
  id?: string; collegeId?: string | null; name?: string; portalName?: string; portalUrl?: string; platform?: string;
  status?: string; round?: string; deadline?: string; decisionDate?: string; notes?: string;
  checklist?: { text?: string; done?: boolean }[]; logins?: CaLogin[]; lastChecked?: number | null;
  portal?: PortalResult; decisionSeen?: string; deleted?: boolean;
};

export async function fetchCollegeAppsVault(email: string, password: string): Promise<CaApp[]> {
  const { authKey, encKey } = await deriveKeys(email, password);
  const login = await fetch(`${COLLEGEAPPS_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase(), authKey }),
    signal: AbortSignal.timeout(20_000),
  });
  if (login.status === 401) throw new ImportError("That College Apps email and password don't match.");
  if (login.status === 429) throw new ImportError("College Apps is limiting sign-in attempts. Wait a minute and try again.");
  if (!login.ok) throw new ImportError("Couldn't sign in to College Apps right now. Try again in a few minutes.");
  const session = (login.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith("ca_session="));
  if (!session) throw new ImportError("Couldn't sign in to College Apps right now. Try again in a few minutes.");
  try {
    const res = await fetch(`${COLLEGEAPPS_URL}/api/vault`, { headers: { cookie: session }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new ImportError("Couldn't read your College Apps data. Try again in a few minutes.");
    const { ciphertext } = (await res.json()) as { ciphertext: string | null };
    if (!ciphertext) return [];
    const vault = (await decryptVault(ciphertext, encKey)) as { apps?: CaApp[] };
    return Array.isArray(vault.apps) ? vault.apps.filter((a) => a && !a.deleted && typeof a.name === "string") : [];
  } finally {
    await fetch(`${COLLEGEAPPS_URL}/api/auth/logout`, { method: "POST", headers: { cookie: session } }).catch(() => undefined);
  }
}

const hostOf = (u: string | undefined) => {
  try {
    return u ? new URL(u).hostname : null;
  } catch {
    return null;
  }
};

/** College Apps schools as Forge applications, with the login each one would use for checks. */
export function toTracked(apps: CaApp[], now = Date.now()): { app: TrackedApp; login: PortalLogin | null }[] {
  return apps.map((a) => {
    const base = newApp({ name: a.name!, collegeId: a.collegeId ?? null, portalUrl: a.portalUrl }, now);
    const checklistNotes = (a.checklist ?? []).filter((c) => c.text).map((c) => `${c.done ? "[x]" : "[ ]"} ${c.text}`);
    const notes = [a.notes ?? "", checklistNotes.length ? `Checklist from College Apps:\n${checklistNotes.join("\n")}` : ""].filter(Boolean).join("\n\n");
    const usable = (a.logins ?? []).filter((l) => l.username && l.password);
    const host = hostOf(a.portalUrl);
    const chosen = usable.find((l) => hostOf(l.url) === host) ?? usable[0];
    const app: TrackedApp = {
      ...base,
      portalName: a.portalName || base.portalName,
      platform: a.platform || base.platform,
      status: (isStatus(a.status) ? a.status : "planning") as StatusId,
      round: (isRound(a.round) ? a.round : "") as RoundId,
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(a.deadline ?? "") ? a.deadline! : "",
      decisionDate: /^\d{4}-\d{2}-\d{2}$/.test(a.decisionDate ?? "") ? a.decisionDate! : "",
      notes: notes.slice(0, 4000),
      lastChecked: typeof a.lastChecked === "number" ? a.lastChecked : null,
      ...(a.portal && typeof a.portal.checkedAt === "number" ? { portal: a.portal } : {}),
      ...(a.decisionSeen ? { decisionSeen: a.decisionSeen } : {}),
      ...(chosen ? { login: { username: chosen.username!, hasPassword: true } } : {}),
    };
    return { app, login: chosen ? { username: chosen.username!, password: chosen.password! } : null };
  });
}
