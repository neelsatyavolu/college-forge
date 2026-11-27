import { NextRequest } from "next/server";
import { runChat } from "@/lib/providers";
import type { ChatEvent, ChatTurn, ProviderName } from "@/lib/chat-types";
import { getWorkspace, updateWorkspace } from "@/lib/store";
import { buildHubSystemPrompt } from "@/lib/hub-context";
import { makeHubTools } from "@/lib/hub-tools";
import { ONBOARDING_WRAP_UP } from "@/lib/tool-budget";
import { dedupeParagraphs, makeInterviewTools, recordTurn } from "@/lib/interview-tools";
import { buildInterviewPrompt, RESEARCH_RULES } from "@/lib/interview-prompt";
import { sensitiveRefusal, toolAllowed } from "@/lib/tool-policy";
import { DECISION_SYSTEM } from "@/lib/decision-plan";
import { getSession, getWorkspaceId } from "@/lib/workspace-cookie";
import { sameSite } from "@/lib/same-site";
import { allow, clientIp } from "@/lib/rate-limit";

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

// Signed-out students on one school or carrier network share an address, so the address cap is generous.
const CHAT_PER_HOUR_ANONYMOUS = 400;
const CHAT_PER_HOUR_SIGNED_IN = 200;

export async function POST(req: NextRequest) {
  if (!sameSite(req)) return Response.json({ error: "Not allowed." }, { status: 403 });
  let body: {
    messages?: unknown;
    provider?: unknown;
    codexModel?: unknown;
    grokModel?: unknown;
    opencodeModel?: unknown;
    /** "onboarding": the setup interview. "research": one school's research step during setup. */
    mode?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "A JSON object is required." }, { status: 400 });
  }

  const turns = sanitize(body.messages);
  if (turns.length === 0) {
    return Response.json({ error: "No messages provided." }, { status: 400 });
  }

  // Each request can spend Forge's own model key, so cap it per account (or per address when signed out).
  // Setup alone runs one request per interview answer plus one per school researched.
  const chatSession = getSession(req);
  const chatBucket = chatSession ? `ai-chat:sub:${chatSession.sub}` : `ai-chat:ip:${clientIp(req)}`;
  if (!(await allow(chatBucket, chatSession ? CHAT_PER_HOUR_SIGNED_IN : CHAT_PER_HOUR_ANONYMOUS, 60 * 60 * 1000))) {
    return Response.json({ error: "You've sent a lot of messages in the last hour. Take a short break and try again soon." }, { status: 429 });
  }

  const { id: workspaceId, setCookie } = await getWorkspaceId(req);
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

  // "decision": the Decision board's picks (lib/decision-plan.ts), with set_decision_picks as the only tool.
  const mode = body.mode === "onboarding" || body.mode === "research" || body.mode === "decision" ? body.mode : "hub";

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
        const lastUserText = [...turns].reverse().find((t) => t.role === "user")?.content || "";
        const hub = makeHubTools(workspaceId, { userText: lastUserText, draftStorageKey: ws.draftStorageKey });
        // Same scope check as the hub tools: a workspace reset mid-chat must not receive these writes.
        const mutate = (fn: Parameters<typeof updateWorkspace>[1]) => updateWorkspace(workspaceId, (w) => {
          if (w.draftStorageKey !== ws.draftStorageKey) throw new Error("This workspace was reset or changed. Start setup again.");
          return fn(w);
        });
        const turnStartedAt = Date.now();
        const interview = makeInterviewTools(mutate, () => getWorkspace(workspaceId), emit, () => Date.now() - turnStartedAt >= ONBOARDING_WRAP_UP.afterMs);
        const setup = mode !== "hub";
        const instructions = mode === "onboarding"
          ? buildInterviewPrompt(ws)
          : mode === "research" ? `${buildHubSystemPrompt(ws)}\n\n${RESEARCH_RULES}`
          // The picks request carries its own data; no workspace snapshot, so a note can't make the model copy it.
          : mode === "decision" ? DECISION_SYSTEM : buildHubSystemPrompt(ws);
        const interviewNames = new Set(interview.tools.map((t) => t.name));
        const tools = (setup ? [...hub.tools.filter((t) => !interviewNames.has(t.name)), ...interview.tools] : hub.tools)
          .filter((t) => toolAllowed(mode, t.name));
        const executeTool: typeof hub.executeTool = async (name, argsJson) => {
          if (!toolAllowed(mode, name)) return `${name} isn't available here.`;
          // Research turns never carry a student message, so the student's words come only from hub chats.
          const refusal = sensitiveRefusal(name, mode === "hub" ? lastUserText : "");
          if (refusal) return refusal;
          return (setup ? await interview.execute(name, argsJson) : null) ?? hub.executeTool(name, argsJson);
        };
        if (mode === "onboarding") {
          await mutate((w) => recordTurn(w, { role: "user", content: lastUserText.slice(0, 4000), at: Date.now() }));
        }

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
          ...(setup ? { requireTools: true, shouldEndTurn: interview.endTurn } : {}),
          // Setup turns can move into the list step mid-turn, and research needs many reads; interview questions end early anyway.
          ...(setup ? { maxRounds: 14 } : {}),
          // Onboarding must hand the student a question or list before the 300-second limit.
          ...(mode === "onboarding" ? { wrapUp: ONBOARDING_WRAP_UP } : {}),
          // Interview questions should come back fast; research and the copilot benefit from more thought.
          effort: mode === "onboarding" ? "low" : "medium",
        });
        if (mode === "onboarding") {
          const ui = interview.shown();
          await mutate((w) => recordTurn(w, { role: "assistant", content: dedupeParagraphs(result.text).slice(0, 4000), ...(ui ? { ui } : {}), at: Date.now() }));
        }

        // Reads and answers do not authorize implicit changes to saved choices.
        // All writes occur through explicit workspace tools above.
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
        console.error(`[ai-chat] ws=${wsTag} error after ${Date.now() - startedAt}ms:`, err);
        emit({ type: "error", message });
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
