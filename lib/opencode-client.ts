import type { ChatTurn, ChatEmitter } from "./chat-types";
import { READ_FILE_TOOL, readContextFile } from "./file-tool";
import { WEB_SEARCH_TOOL, runWebSearch } from "./web-search-tool";
import {
  friendlyRoundMessage,
  friendlyWritingMessage,
  friendlyThinkingMessage,
  friendlyCutOffNote,
  friendlyToolBudgetNote,
} from "./chat-status";

const DEFAULT_BASE_URL = process.env.OPENCODE_API_URL ?? "https://opencode.ai/zen/go/v1";
const MAX_ROUNDS = 6;
// Abort a stalled upstream request rather than hanging the user's spinner.
const UPSTREAM_TIMEOUT_MS = 90_000;

export const OPENCODE_MODELS = [
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", tier: "" },
  { id: "minimax-m2.7", label: "MiniMax M2.7", tier: "" },
  { id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro", tier: "" },
  { id: "kimi-k2.6", label: "Kimi K2.6", tier: "" },
] as const;

export const DEFAULT_OPENCODE_MODEL = process.env.OPENCODE_MODEL ?? "deepseek-v4-pro";

export function getOpencodeKey(): string | null {
  return process.env.OPENCODE_API_KEY ?? null;
}

export function isKnownOpencodeModel(id: string): boolean {
  return OPENCODE_MODELS.some((m) => m.id === id);
}

type AssistantToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenCodeMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      reasoning_content?: string;
      tool_calls?: AssistantToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

// Short label shown in the progress trace for a tool call — a file path for
// read_file, or the query for web_search.
function toolTargetFromArgs(args: string | undefined): string | undefined {
  try {
    const parsed = JSON.parse(args || "{}");
    if (parsed && typeof parsed.path === "string") return parsed.path;
    if (parsed && typeof parsed.query === "string") return parsed.query;
  } catch {
    // ignore — the tool event is still useful without a target
  }
  return undefined;
}

async function callOpencode(
  apiKey: string,
  model: string,
  messages: OpenCodeMessage[]
): Promise<{
  text: string;
  reasoning?: string;
  toolCalls: AssistantToolCall[];
  finishReason: string | null;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${DEFAULT_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools: [
          { type: "function", function: READ_FILE_TOOL },
          { type: "function", function: WEB_SEARCH_TOOL },
        ],
        temperature: 0.4,
        max_tokens: 16384,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenCode request failed (${res.status}): ${detail.slice(0, 400)}`);
    }

    const json = (await res.json()) as {
      choices?: {
        finish_reason?: string;
        message?: {
          content?: string | null;
          reasoning_content?: string;
          tool_calls?: AssistantToolCall[];
        };
      }[];
    };
    const choice = json.choices?.[0] ?? {};
    const msg = choice.message ?? {};
    return {
      text: typeof msg.content === "string" ? msg.content : "",
      reasoning: typeof msg.reasoning_content === "string" ? msg.reasoning_content : undefined,
      toolCalls: msg.tool_calls ?? [],
      finishReason: choice.finish_reason ?? null,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`OpenCode request timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s.`);
    }
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
}

async function executeTool(call: AssistantToolCall): Promise<string> {
  const name = call.function.name;
  let parsed: { path?: unknown; query?: unknown };
  try {
    parsed = JSON.parse(call.function.arguments || "{}");
  } catch {
    return `Invalid JSON arguments for ${name}.`;
  }
  if (name === "read_file") {
    if (typeof parsed.path !== "string") return "read_file requires a string 'path' argument.";
    const result = await readContextFile(parsed.path);
    return result.ok ? result.content : result.error;
  }
  if (name === "web_search") {
    if (typeof parsed.query !== "string") return "web_search requires a string 'query' argument.";
    const result = await runWebSearch(parsed.query);
    return result.ok ? result.content : result.error;
  }
  return `Unknown tool: ${name}`;
}

export type OpencodeChatResult = {
  text: string;
  finishReason: string | null;
  rounds: number;
  truncated: boolean;
};

export async function runOpencodeChat(params: {
  apiKey: string;
  instructions: string;
  turns: ChatTurn[];
  model?: string;
  emit: ChatEmitter;
}): Promise<OpencodeChatResult> {
  const { emit } = params;
  const model =
    params.model && isKnownOpencodeModel(params.model) ? params.model : DEFAULT_OPENCODE_MODEL;
  const messages: OpenCodeMessage[] = [
    { role: "system", content: params.instructions },
    ...params.turns.map((t) => ({ role: t.role, content: t.content }) as OpenCodeMessage),
  ];

  // Accumulate text across tool-rounds so we don't drop the partial reply
  // that accompanied a tool call.
  let accumulated = "";
  let truncated = false;
  let lastFinishReason: string | null = null;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    emit({
      type: "status",
      stage: round === 0 ? "thinking" : "round",
      message: friendlyRoundMessage(round + 1),
      round: round + 1,
    });

    const { text, reasoning, toolCalls, finishReason } = await callOpencode(
      params.apiKey,
      model,
      messages
    );
    lastFinishReason = finishReason;
    if (finishReason === "length") truncated = true;

    if (reasoning && reasoning.trim()) {
      emit({
        type: "status",
        stage: "reasoning",
        message: friendlyThinkingMessage(),
        round: round + 1,
      });
    }

    if (text) {
      const out = (accumulated ? "\n\n" : "") + text;
      accumulated += out;
      emit({ type: "status", stage: "writing", message: friendlyWritingMessage(), round: round + 1 });
      emit({ type: "delta", text: out });
    }

    if (toolCalls.length === 0) {
      if (truncated) {
        const suffix = friendlyCutOffNote();
        accumulated += suffix;
        emit({ type: "delta", text: suffix });
      }
      return { text: accumulated, finishReason: lastFinishReason, rounds: round + 1, truncated };
    }

    messages.push({
      role: "assistant",
      content: text || null,
      reasoning_content: reasoning,
      tool_calls: toolCalls,
    });
    for (const call of toolCalls) {
      emit({
        type: "tool",
        name: call.function.name,
        path: toolTargetFromArgs(call.function.arguments),
        round: round + 1,
      });
      const output = await executeTool(call);
      messages.push({ role: "tool", tool_call_id: call.id, content: output });
    }
  }

  const suffix = friendlyToolBudgetNote();
  accumulated += suffix;
  emit({ type: "delta", text: suffix });
  return { text: accumulated, finishReason: "tool_round_limit", rounds: MAX_ROUNDS, truncated };
}
