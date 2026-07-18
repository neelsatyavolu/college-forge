import { NextRequest } from "next/server";
import { runChat } from "@/lib/providers";
import type { ChatEvent, ChatTurn, ProviderName } from "@/lib/chat-types";
import { getWorkspace } from "@/lib/store";
import { buildHubSystemPrompt } from "@/lib/hub-context";
import { makeHubTools } from "@/lib/hub-tools";
import { getWorkspaceId } from "@/lib/workspace-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_TURNS = 24;
const MAX_CONTENT_LEN = 8_000;

type IncomingTurn = { role: "user" | "assistant"; content: string };

function sanitize(messages: unknown): ChatTurn[] {
  if (!Array.isArray(messages)) return [];
  const cleaned: ChatTurn[] = [];
  for (const m of messages.slice(-MAX_TURNS) as IncomingTurn[]) {
    if (!m || typeof m !== "object") continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (typeof m.content !== "string" || !m.content.trim()) continue;
    cleaned.push({ role: m.role, content: m.content.slice(0, MAX_CONTENT_LEN) });
  }
  return cleaned;
}

export async function POST(req: NextRequest) {
  let body: {
    messages?: unknown;
    provider?: unknown;
    codexModel?: unknown;
    grokModel?: unknown;
    opencodeModel?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const turns = sanitize(body.messages);
  if (turns.length === 0) {
    return Response.json({ error: "No messages provided." }, { status: 400 });
  }

  const { id: workspaceId, setCookie } = getWorkspaceId(req);
  const wsTag = workspaceId.slice(0, 8);
  if (setCookie) {
    // The browser should already hold a workspace cookie from GET /api/workspace.
    // Minting one here means the chat is writing to a DIFFERENT workspace than
    // the page is reading — the classic "AI updated it but the page is blank".
    console.warn(`[ai-chat] no workspace cookie on request — minted ws=${wsTag}`);
  }

  const preferred: ProviderName | undefined =
    body.provider === "codex" || body.provider === "grok" || body.provider === "opencode"
      ? body.provider
      : undefined;
  const opencodeModel = typeof body.opencodeModel === "string" ? body.opencodeModel : undefined;
  const codexModel = typeof body.codexModel === "string" ? body.codexModel : undefined;
  const grokModel = typeof body.grokModel === "string" ? body.grokModel : undefined;

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: ChatEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };

      try {
        emit({ type: "status", stage: "context", message: "Loading your hub…" });
        const ws = await getWorkspace(workspaceId);
        const instructions = buildHubSystemPrompt(ws);
        const { tools, executeTool } = makeHubTools(workspaceId);

        console.log(
          `[ai-chat] start ws=${wsTag} turns=${turns.length} uploads=${ws.uploads.length} ` +
            `colleges(before)=${ws.colleges.length} tools=${tools.length}`
        );

        // Count tool calls so the logs distinguish "model wrote to the hub"
        // from "model only talked about writing to the hub".
        let toolCalls = 0;
        const countingExecuteTool: typeof executeTool = (name, argsJson) => {
          toolCalls++;
          return executeTool(name, argsJson);
        };

        const result = await runChat({
          instructions,
          turns,
          preferred,
          codexModel,
          grokModel,
          opencodeModel,
          emit,
          tools,
          executeTool: countingExecuteTool,
        });

        const after = await getWorkspace(workspaceId);
        console.log(
          `[ai-chat] done ws=${wsTag} provider=${result.provider} model=${result.model ?? "?"} ` +
            `rounds=${result.rounds} toolCalls=${toolCalls} ` +
            `colleges(after)=${after.colleges.length} activities(after)=${after.profile.activities.length} ` +
            `finish=${result.finishReason ?? "?"} ms=${Date.now() - startedAt}` +
            (toolCalls === 0 ? "  ⚠️ model made NO tool calls — nothing was written" : "")
        );

        emit({
          type: "done",
          provider: result.provider,
          model: result.model,
          rounds: result.rounds,
          finishReason: result.finishReason,
          truncated: result.truncated,
          textLength: result.text.length,
          elapsedMs: Date.now() - startedAt,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const detail =
          err instanceof Error && err.stack
            ? err.stack.split("\n").slice(0, 5).join("\n")
            : undefined;
        console.error(`[ai-chat] ws=${wsTag} error after ${Date.now() - startedAt}ms:`, err);
        emit({ type: "error", message, detail });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  const headers: Record<string, string> = {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  };
  if (setCookie) headers["set-cookie"] = setCookie;

  return new Response(stream, { headers });
}
