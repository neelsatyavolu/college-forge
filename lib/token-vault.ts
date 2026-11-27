/**
 * The student's AI sign-in (ChatGPT or Grok OAuth tokens), held on the server only while background
 * research runs so it can continue after the tab closes. Encrypted with AES-256-GCM under
 * FORGE_TOKEN_KEY (32 bytes, base64), stored apart from the workspace document so exports and share
 * links can never carry it, and deleted when research ends, on sign-out and on workspace reset.
 * Without FORGE_TOKEN_KEY nothing is stored and research runs in the browser as before.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readAiVaultText, writeAiVaultText, deleteAiVaultText } from "./store";
import type { Tokens } from "@neelsatyavolu/shared-ai-auth";

export type VaultProvider = "codex" | "grok";
export type VaultEntry = { provider: VaultProvider; tokens: Tokens; model?: string; savedAt: number };

function key(): Buffer | null {
  const raw = process.env.FORGE_TOKEN_KEY;
  if (!raw) return null;
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

export const vaultAvailable = (): boolean => key() !== null;

export function sealVault(entry: VaultEntry, k: Buffer | null = key()): string {
  if (!k) throw new Error("FORGE_TOKEN_KEY is not set.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(entry), "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), body: body.toString("base64") });
}

export function openVault(text: string, k: Buffer | null = key()): VaultEntry | null {
  if (!k) return null;
  try {
    const box = JSON.parse(text);
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(box.iv, "base64"));
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

export async function loadVault(workspaceId: string): Promise<VaultEntry | null> {
  const text = await readAiVaultText(workspaceId);
  return text ? openVault(text) : null;
}

export async function clearVault(workspaceId: string): Promise<void> {
  await deleteAiVaultText(workspaceId).catch(() => undefined);
}

/** Signs a background-run hand-off so only Forge itself can continue a student's run. */
export function signRun(workspaceId: string, runId: string, worker: number, k: Buffer | null = key()): string {
  if (!k) throw new Error("FORGE_TOKEN_KEY is not set.");
  return createHmac("sha256", k).update(`research-run:${workspaceId}:${runId}:${worker}`).digest("base64url");
}

export function verifyRun(workspaceId: string, runId: string, worker: number, sig: string, k: Buffer | null = key()): boolean {
  if (!k || typeof sig !== "string") return false;
  const want = Buffer.from(signRun(workspaceId, runId, worker, k));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
