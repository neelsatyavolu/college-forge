import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Small JSON documents kept beside workspaces: accounts, encrypted portal logins, OAuth clients and tokens.
 * Vercel Blob in production (private, conditional writes), files under data/ locally.
 */

function useBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function dataDir(): string {
  return process.env.CF_DATA_DIR ? path.resolve(process.env.CF_DATA_DIR) : path.join(process.cwd(), "data");
}

/** Keys are built by this app from fixed prefixes and hashed or validated ids; this keeps them inside the store. */
function checkKey(key: string): string {
  if (!/^[a-z0-9-]+(\/[A-Za-z0-9_.-]+)+$/.test(key) || key.includes("..")) throw new Error("Invalid document key.");
  return key;
}

async function readBlob(key: string): Promise<{ text: string; etag: string } | null> {
  const { get } = await import("@vercel/blob");
  const res = await get(key, { access: "private", useCache: false, headers: { "accept-encoding": "identity" } });
  if (res === null) return null;
  if (res.statusCode !== 200 || !res.stream) throw new Error(`Unexpected storage response: ${res.statusCode}`);
  return { text: await new Response(res.stream).text(), etag: res.blob.etag };
}

export async function readDoc<T>(key: string): Promise<T | null> {
  checkKey(key);
  let text: string | null;
  if (useBlob()) {
    text = (await readBlob(key))?.text ?? null;
  } else {
    try {
      text = await fs.readFile(path.join(dataDir(), key), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  return text === null ? null : (JSON.parse(text) as T);
}

export async function writeDoc(key: string, value: unknown): Promise<void> {
  checkKey(key);
  const text = JSON.stringify(value);
  if (useBlob()) {
    const { put } = await import("@vercel/blob");
    await put(key, text, { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
    return;
  }
  const full = path.join(dataDir(), key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const temporary = `${full}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, full);
}

export async function deleteDoc(key: string): Promise<void> {
  checkKey(key);
  if (useBlob()) {
    const { del } = await import("@vercel/blob");
    await del(key);
    return;
  }
  await fs.unlink(path.join(dataDir(), key)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const localQueues = new Map<string, Promise<unknown>>();

/**
 * Read-modify-write with optimistic concurrency on Blob (ETag) and a per-process queue locally.
 * `mutate` must be replayable: it can run more than once when a write races another.
 */
export async function updateDoc<T>(key: string, mutate: (current: T | null) => T): Promise<T> {
  checkKey(key);
  if (!useBlob()) {
    const previous = localQueues.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
      const next = mutate(await readDoc<T>(key));
      await writeDoc(key, next);
      return next;
    });
    localQueues.set(key, run);
    try {
      return await run;
    } finally {
      if (localQueues.get(key) === run) localQueues.delete(key);
    }
  }
  const { put, BlobError, BlobPreconditionFailedError } = await import("@vercel/blob");
  for (let attempt = 0; attempt < 8; attempt++) {
    const snapshot = await readBlob(key);
    const next = mutate(snapshot ? (JSON.parse(snapshot.text) as T) : null);
    try {
      await put(key, JSON.stringify(next), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        ...(snapshot ? { allowOverwrite: true, ifMatch: snapshot.etag } : { allowOverwrite: false }),
      });
      return next;
    } catch (error) {
      const conflict =
        error instanceof BlobPreconditionFailedError ||
        (error instanceof BlobError && /already exists|conflicting operation/i.test(error.message));
      if (!conflict) throw error;
      await wait(10 * 2 ** attempt + Math.floor(Math.random() * 20));
    }
  }
  throw new Error("Couldn't save after repeated conflicts. Please retry.");
}

/** Keys under a prefix (used by the automatic-check sweep). */
export async function listDocs(prefix: string): Promise<string[]> {
  checkKey(`${prefix}x`);
  if (useBlob()) {
    const { list } = await import("@vercel/blob");
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      keys.push(...page.blobs.map((b) => b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return keys;
  }
  const dir = path.join(dataDir(), prefix);
  try {
    return (await fs.readdir(dir)).filter((f) => !f.endsWith(".tmp")).map((f) => `${prefix}${f}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
