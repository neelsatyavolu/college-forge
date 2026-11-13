import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { deleteDoc, readDoc, updateDoc } from "./doc-store";

/**
 * Portal usernames and passwords, one encrypted document per workspace (AES-256-GCM, key from
 * PORTAL_LOGINS_KEY). Kept out of the workspace so share links, exports, the AI copilot and MCP never see them.
 * Only the server's portal checker reads them back.
 */

export type PortalLogin = { username: string; password: string };
type Sealed = { v: 1; iv: string; ct: string; tag: string };

function key(): Buffer {
  const raw = process.env.PORTAL_LOGINS_KEY;
  if (!raw) throw new Error("PORTAL_LOGINS_KEY is not set");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("PORTAL_LOGINS_KEY must be 32 bytes, base64");
  return k;
}

const docKey = (workspaceId: string) => `logins/${workspaceId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)}.json`;

/** The workspace id is bound into the ciphertext, so a sealed document can't be moved to another workspace. */
function seal(workspaceId: string, value: Record<string, PortalLogin>): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`forge-logins:${workspaceId}`));
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), ct: ct.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function open(workspaceId: string, sealed: Sealed | null): Record<string, PortalLogin> {
  if (!sealed) return {};
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(sealed.iv, "base64"));
  decipher.setAAD(Buffer.from(`forge-logins:${workspaceId}`));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(sealed.ct, "base64")), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as Record<string, PortalLogin>;
}

export async function readLogins(workspaceId: string): Promise<Record<string, PortalLogin>> {
  return open(workspaceId, await readDoc<Sealed>(docKey(workspaceId)));
}

/** Sets (or with null, removes) logins by application id. */
export async function saveLogins(workspaceId: string, changes: Record<string, PortalLogin | null>): Promise<void> {
  await updateDoc<Sealed>(docKey(workspaceId), (current) => {
    const next = { ...open(workspaceId, current) };
    for (const [appId, login] of Object.entries(changes)) {
      if (login) next[appId] = { username: login.username.slice(0, 254), password: login.password.slice(0, 256) };
      else delete next[appId];
    }
    return seal(workspaceId, next);
  });
}

export async function deleteAllLogins(workspaceId: string): Promise<void> {
  await deleteDoc(docKey(workspaceId));
}
