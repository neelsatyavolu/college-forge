import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * What `collegeforge login` keeps on this computer: the OAuth tokens Forge issued to this tool. Readable
 * only by this user (0600), like an SSH key. Anyone who can read it can read your saved portal passwords
 * until you run `collegeforge logout` or disconnect the tool in Forge settings.
 */
export interface Session {
  url: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

type Env = Record<string, string | undefined>;

export function sessionPath(env: Env = process.env): string {
  const dir = env.COLLEGEFORGE_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "collegeforge");
  return join(dir, "session.json");
}

export async function readSession(env: Env = process.env): Promise<Session | null> {
  let raw: string;
  try {
    raw = await readFile(sessionPath(env), "utf8");
  } catch {
    return null;
  }
  try {
    const s = JSON.parse(raw) as Record<string, unknown>;
    const strings = ["url", "clientId", "accessToken", "refreshToken"] as const;
    if (!strings.every((f) => typeof s[f] === "string" && s[f]) || typeof s.expiresAt !== "number") return null;
    return { url: s.url as string, clientId: s.clientId as string, accessToken: s.accessToken as string, refreshToken: s.refreshToken as string, expiresAt: s.expiresAt };
  } catch {
    return null;
  }
}

export async function saveSession(session: Session, env: Env = process.env): Promise<void> {
  const path = sessionPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(session, null, 2) + "\n", { mode: 0o600 });
  // writeFile's mode only applies when it creates the file.
  await chmod(path, 0o600);
}

export async function clearSession(env: Env = process.env): Promise<void> {
  await rm(sessionPath(env), { force: true });
}
