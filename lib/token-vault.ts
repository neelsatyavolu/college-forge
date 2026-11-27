/**
 * The student's AI sign-in (ChatGPT or Grok OAuth tokens), held on the server only while background
 * research runs so it can continue after the tab closes. Encrypted with AES-256-GCM under
 * FORGE_TOKEN_KEY (32 bytes, base64), stored apart from the workspace document so exports and share
 * links can never carry it, and deleted when research ends, on sign-out and on workspace reset.
 * Without FORGE_TOKEN_KEY nothing is stored and research runs in the browser as before.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { readAiVaultText, writeAiVaultText, deleteAiVaultText } from "./store";
import type { Tokens } from "@neelsatyavolu/shared-ai-auth";

export type VaultProvider = "codex" | "grok";
/**
 * createdAt: when research started (the entry is useless after VAULT_TTL_MS, whatever happens).
 * binding: hash of the random cookie set in the browser that started research; tokens are only ever
 * synced with that browser. doneAt: the run finished; the starting browser takes the newest tokens,
 * then the entry is deleted.
 */
export type VaultEntry = { provider: VaultProvider; tokens: Tokens; model?: string; savedAt: number; createdAt: number; binding: string; doneAt?: number };

export const VAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const BINDING_COOKIE = "forge_research_bind";

function key(): Buffer | null {
  const raw = process.env.FORGE_TOKEN_KEY;
  if (!raw) return null;
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

/** Separate subkeys for encryption and for signing hand-offs. */
const subkey = (k: Buffer, label: string): Buffer => Buffer.from(hkdfSync("sha256", k, Buffer.alloc(0), `forge-token-vault:${label}`, 32));

export const newBinding = (): string => randomBytes(24).toString("base64url");
export const bindingHash = (cookie: string): string => createHash("sha256").update(cookie).digest("base64url");

/** Whether this browser's binding cookie is the one that started the run. */
export function boundTo(entry: VaultEntry, cookie: string | undefined): boolean {
  if (!cookie || !entry.binding) return false;
  const a = Buffer.from(bindingHash(cookie));
  const b = Buffer.from(entry.binding);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const vaultAvailable = (): boolean => key() !== null;

export function sealVault(entry: VaultEntry, k: Buffer | null = key()): string {
  if (!k) throw new Error("FORGE_TOKEN_KEY is not set.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subkey(k, "enc"), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(entry), "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), body: body.toString("base64") });
}

export function openVault(text: string, k: Buffer | null = key()): VaultEntry | null {
  if (!k) return null;
  try {
    const box = JSON.parse(text);
    const decipher = createDecipheriv("aes-256-gcm", subkey(k, "enc"), Buffer.from(box.iv, "base64"));
    decipher.setAuthTag(Buffer.from(box.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(box.body, "base64")), decipher.final()]).toString("utf8");
    const entry = JSON.parse(plain) as VaultEntry;
    return entry.provider === "codex" || entry.provider === "grok" ? entry : null;
  } catch {
    return null;
  }
}

export async function saveVault(workspaceId: string, entry: VaultEntry): Promise<void> {
  await writeAiVaultText(workspaceId, sealVault(entry));
}

/** The stored entry, or null; an entry past VAULT_TTL_MS (or unreadable) is deleted on sight. */
export async function loadVault(workspaceId: string, now = Date.now()): Promise<VaultEntry | null> {
  const text = await readAiVaultText(workspaceId);
  if (!text) return null;
  const entry = openVault(text);
  if (!entry || !(now - entry.createdAt < VAULT_TTL_MS)) {
    await clearVault(workspaceId);
    return null;
  }
  return entry;
}

export async function clearVault(workspaceId: string): Promise<void> {
  await deleteAiVaultText(workspaceId).catch(() => undefined);
}

/** Signs a background-run hand-off so only Forge itself can continue a student's run. */
export function signRun(workspaceId: string, runId: string, worker: number, k: Buffer | null = key()): string {
  if (!k) throw new Error("FORGE_TOKEN_KEY is not set.");
  return createHmac("sha256", subkey(k, "mac")).update(`research-run:${workspaceId}:${runId}:${worker}`).digest("base64url");
}

export function verifyRun(workspaceId: string, runId: string, worker: number, sig: string, k: Buffer | null = key()): boolean {
  if (!k || typeof sig !== "string") return false;
  const want = Buffer.from(signRun(workspaceId, runId, worker, k));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
