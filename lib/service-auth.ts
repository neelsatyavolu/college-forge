import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Whether a request carries FORGE_SERVICE_KEY, the secret Forge and the College Apps Worker share. */
export function fromCollegeAppsWorker(req: Request): boolean {
  const secret = process.env.FORGE_SERVICE_KEY;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return !!secret && !!given && timingSafeEqual(digest(given), digest(secret));
}

/** How a College Apps account is remembered once it moved to Forge: a hash of its email, never the email. */
export const emailHash = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
