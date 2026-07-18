import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type ShareRecord = {
  token: string;
  workspaceId: string;
  label: string;
  createdAt: number;
  revokedAt?: number;
};

function useBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function dataDir(): string {
  return process.env.CF_DATA_DIR
    ? path.resolve(process.env.CF_DATA_DIR)
    : path.join(process.cwd(), "data");
}

async function readText(key: string): Promise<string | null> {
  if (useBlob()) {
    try {
      const { get } = await import("@vercel/blob");
      const res = await get(key, { access: "private", useCache: false });
      if (!res || res.statusCode !== 200 || !res.stream) return null;
      return await new Response(res.stream).text();
    } catch {
      return null;
    }
  }
  try {
    return await fs.readFile(path.join(dataDir(), key), "utf8");
  } catch {
    return null;
  }
}

async function writeText(key: string, text: string): Promise<void> {
  if (useBlob()) {
    const { put } = await import("@vercel/blob");
    await put(key, text, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }
  const full = path.join(dataDir(), key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, text, "utf8");
}

const shareKey = (token: string) => `shares/${token.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)}.json`;
const recoveryKey = (code: string) =>
  `recovery/${code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 16)}.json`;

export function newShareToken(): string {
  return randomBytes(18).toString("base64url");
}

export function newRecoveryCode(): string {
  // 8 chars, easy to type (no 0/O/1/I)
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

export async function putShare(rec: ShareRecord): Promise<void> {
  await writeText(shareKey(rec.token), JSON.stringify(rec));
}

export async function getShare(token: string): Promise<ShareRecord | null> {
  const raw = await readText(shareKey(token));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ShareRecord;
  } catch {
    return null;
  }
}

export async function putRecovery(code: string, workspaceId: string): Promise<void> {
  await writeText(
    recoveryKey(code),
    JSON.stringify({ code: code.toUpperCase(), workspaceId, createdAt: Date.now() })
  );
}

export async function getRecovery(code: string): Promise<{ workspaceId: string } | null> {
  const raw = await readText(recoveryKey(code));
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { workspaceId?: string };
    if (!j.workspaceId) return null;
    return { workspaceId: j.workspaceId };
  } catch {
    return null;
  }
}
