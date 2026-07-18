import { promises as fs } from "node:fs";
import path from "node:path";

const PER_READ_CHAR_CAP = 40_000;

function contextDir(): string {
  return path.join(process.cwd(), "data", "context");
}

function isSafeRelative(relPath: string): boolean {
  if (!relPath || relPath.startsWith("/") || relPath.includes("..")) return false;
  const normalized = path.normalize(relPath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return false;
  return true;
}

export type ReadFileResult = { ok: true; content: string } | { ok: false; error: string };

export async function readContextFile(relPath: string): Promise<ReadFileResult> {
  if (!isSafeRelative(relPath)) {
    return { ok: false, error: "Path must be a safe relative path inside data/context/." };
  }
  const full = path.join(contextDir(), relPath);
  try {
    const raw = await fs.readFile(full, "utf8");
    if (raw.length <= PER_READ_CHAR_CAP) return { ok: true, content: raw };
    return {
      ok: true,
      content: raw.slice(0, PER_READ_CHAR_CAP) + "\n\n[…file truncated…]",
    };
  } catch (err) {
    const reason = err && typeof err === "object" && "code" in err ? err.code : "ENOENT";
    return { ok: false, error: `Could not read ${relPath} (${reason}).` };
  }
}

export const READ_FILE_TOOL = {
  name: "read_file",
  description:
    "Read a markdown file from the Colleges Hub. Path is relative to the hub root (e.g. 'schools/stanford/research.md', 'essays/common-app/personal-statement.md'). Returns the file content. Pick from the file manifest provided in the system prompt.",
  parameters: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Relative path to a markdown file listed in the manifest.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
};
