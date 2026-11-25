/**
 * Gives the in-app copilot the MCP server's tools it doesn't already have: the applications tracker
 * (statuses, decisions, follow-ups, flags, portal checks), share links, notes and read views. Both
 * surfaces then run the same validated code, so the copilot can see and change everything an
 * outside agent can.
 */
import { z } from "zod";
import type { ToolSpec } from "./chat-types";
import { TOOLS, callTool } from "./mcp-tools";

/** MCP tools the copilot covers with its own versions (profile, list prefs, essays) or must not run. */
const COVERED = new Set(["update_profile", "update_list_preferences", "complete_onboarding"]);

export function bridgeToolSpecs(hubNames: ReadonlySet<string>): ToolSpec[] {
  return TOOLS.filter((t) => !hubNames.has(t.name) && !COVERED.has(t.name)).map((t) => {
    const { $schema: _s, ...parameters } = z.toJSONSchema(t.input) as Record<string, unknown>;
    return { name: t.name, description: t.description, parameters };
  });
}

/** Runs a bridged tool; null when `name` isn't one of them. */
export async function runBridgeTool(workspaceId: string, names: ReadonlySet<string>, name: string, argsJson: string): Promise<string | null> {
  if (!names.has(name)) return null;
  let args: unknown;
  try {
    args = JSON.parse(argsJson || "{}");
  } catch {
    return `Invalid JSON arguments for ${name}.`;
  }
  const r = (await callTool(workspaceId, name, args)) as { content: { text: string }[] };
  return r.content.map((c) => c.text).join("\n");
}
