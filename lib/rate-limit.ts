import { createHash } from "node:crypto";
import { updateDoc } from "./doc-store";

/**
 * A small sliding-window limit kept in storage, for the few endpoints that do expensive or storage-writing
 * work for callers who may not be signed in (assistant registration) or that proxy a password check
 * (College Apps import). Returns false once `limit` calls happened within `windowMs`.
 */
export async function allow(bucket: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  const key = `ratelimit/${createHash("sha256").update(bucket).digest("hex")}.json`;
  let ok = false;
  await updateDoc<{ hits: number[] }>(key, (cur) => {
    const hits = (cur?.hits ?? []).filter((t) => now - t < windowMs);
    ok = hits.length < limit;
    return { hits: ok ? [...hits, now] : hits };
  });
  return ok;
}

/** The caller's address as Vercel reports it. */
export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || req.headers.get("x-real-ip") || "unknown";
}
