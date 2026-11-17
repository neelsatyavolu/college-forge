import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliError } from "./errors";

/**
 * Copies portal logins into 1Password with the 1Password CLI (`op`). Each item is a Login with the portal
 * link, so 1Password fills it on the school's own site. Passwords go to `op` in an item template file (only
 * this user can read it, deleted right after), never as command arguments, which other processes could see.
 * `op` doesn't read a template from Node's standard input, which is a socket, not a pipe. Items get the
 * "collegeforge" tag; items with it, or with "collegeapps" from the older tool, count as already copied.
 * Ported from College Apps (cli/onepassword.ts).
 */

export const TAG = "collegeforge";
const KNOWN_TAGS = [TAG, "collegeapps"];

export interface OpResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `op`; a `template` (item JSON) is passed with --template. */
export type OpRunner = (args: string[], template?: string) => Promise<OpResult>;

export const runOp: OpRunner = async (args, template) => {
  if (template === undefined) return spawnOp(args);
  const dir = await mkdtemp(join(tmpdir(), "collegeforge-op-"));
  const file = join(dir, "item.json");
  try {
    await writeFile(file, template, { mode: 0o600 });
    return await spawnOp([...args, "--template", file]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const spawnOp = (args: string[]): Promise<OpResult> =>
  new Promise((resolve, reject) => {
    const child = spawn("op", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err: NodeJS.ErrnoException) =>
      reject(err.code === "ENOENT" ? new CliError("The 1Password CLI (op) isn't installed. Get it at https://developer.1password.com/docs/cli/get-started/") : err),
    );
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end();
  });

/** One saved portal login to copy. */
export interface Picked {
  school: string;
  portalUrl: string;
  username: string;
  password: string;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const keyOf = (url: string, username: string) => `${hostOf(url)}|${username.trim().toLowerCase()}`;

/** The 1Password item template for one login. */
export function itemTemplate(p: Picked): Record<string, unknown> {
  const url = p.portalUrl;
  return {
    title: p.school,
    category: "LOGIN",
    tags: [TAG],
    urls: url ? [{ label: "website", primary: true, href: url }] : [],
    fields: [
      { id: "username", type: "STRING", purpose: "USERNAME", label: "username", value: p.username },
      { id: "password", type: "CONCEALED", purpose: "PASSWORD", label: "password", value: p.password },
      { id: "notesPlain", type: "STRING", purpose: "NOTES", label: "notesPlain", value: "Saved from Forge." },
    ],
  };
}

async function existingKeys(op: OpRunner, vault?: string): Promise<Set<string>> {
  const res = await op(["item", "list", "--tags", KNOWN_TAGS.join(","), "--categories", "Login", "--format", "json", ...(vault ? ["--vault", vault] : [])]);
  if (res.code !== 0) throw new CliError(`1Password CLI: ${res.stderr.trim() || "couldn't list items"}. Is the 1Password app unlocked, or are you signed in with "op signin"?`);
  const items = JSON.parse(res.stdout || "[]") as { urls?: { href: string }[]; additional_information?: string }[];
  return new Set(items.flatMap((i) => (i.urls ?? []).map((u) => keyOf(u.href, i.additional_information ?? ""))));
}

export interface SaveReport {
  created: Picked[];
  skipped: Picked[];
  failed: { picked: Picked; error: string }[];
}

export async function saveTo1Password(picked: Picked[], opts: { vault?: string; dryRun?: boolean }, op: OpRunner = runOp): Promise<SaveReport> {
  const have = await existingKeys(op, opts.vault);
  const report: SaveReport = { created: [], skipped: [], failed: [] };
  for (const p of picked) {
    const key = keyOf(p.portalUrl, p.username);
    if (have.has(key)) {
      report.skipped.push(p);
      continue;
    }
    const args = ["item", "create", ...(opts.vault ? ["--vault", opts.vault] : []), ...(opts.dryRun ? ["--dry-run"] : []), "--format", "json"];
    const res = await op(args, JSON.stringify(itemTemplate(p)));
    if (res.code === 0) {
      report.created.push(p);
      have.add(key);
    } else report.failed.push({ picked: p, error: res.stderr.trim().split("\n")[0] ?? "op failed" });
  }
  return report;
}
