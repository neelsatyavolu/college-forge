import type { ChatTurn, ChatEmitter, ToolSpec, ToolExecutor } from "./chat-types";
import { READ_FILE_TOOL, readContextFile } from "./file-tool";
import { WEB_SEARCH_TOOL, WEB_FETCH_TOOL, runWebSearch, runWebFetch } from "./web-search-tool";
import {
  friendlyRoundMessage,
  friendlyWritingMessage,
  friendlyCutOffNote,
  friendlyToolBudgetNote,
} from "./chat-status";
import {
  DEFAULT_GROK_MODEL,
  GROK_API_BASE,
  type GrokTokens,
} from "./grok-oauth";
import { providerModels } from "./ai-models";

// Hub builds need several tool rounds (web_search × N + set_* + upsert_college).
const MAX_ROUNDS = 10;
const UPSTREAM_TIMEOUT_MS = 90_000;

export { DEFAULT_GROK_MODEL };

type AssistantToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type GrokMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: AssistantToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

function toolTargetFromArgs(args: string | undefined): string | undefined {
  try {
    const parsed = JSON.parse(args || "{}");
    if (parsed && typeof parsed.path === "string") return parsed.path;
    if (parsed && typeof parsed.query === "string") return parsed.query;
    if (parsed && typeof parsed.url === "string") return parsed.url;
  } catch {
    // The trace still shows the tool name when arguments are malformed.
  }
  return undefined;
}

async function callGrok(
  tokens: GrokTokens,
  model: string,
  messages: GrokMessage[],
  tools: ToolSpec[]
): Promise<{
  text: string;
  toolCalls: AssistantToolCall[];
  finishReason: string | null;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${GROK_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({
        model,
        messages,
        tools: tools.map((t) => ({ type: "function", function: t })),
        temperature: 0.4,
        max_tokens: 16384,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Grok request failed (${res.status}): ${detail.slice(0, 400)}`);
    }

    const json = (await res.json()) as {
      choices?: {
        finish_reason?: string;
        message?: {
          content?: string | null;
          tool_calls?: AssistantToolCall[];
        };
      }[];
    };
    const choice = json.choices?.[0] ?? {};
    const msg = choice.message ?? {};
    return {
      text: typeof msg.content === "string" ? msg.content : "",
      toolCalls: msg.tool_calls ?? [],
      finishReason: choice.finish_reason ?? null,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Grok request timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s.`);
    }
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
}

const DEFAULT_TOOLS: ToolSpec[] = [READ_FILE_TOOL, WEB_SEARCH_TOOL, WEB_FETCH_TOOL];

async function defaultExecuteTool(name: string, argsJson: string): Promise<string> {
  let parsed: { path?: unknown; query?: unknown; url?: unknown; purpose?: unknown };
  try {
    parsed = JSON.parse(argsJson || "{}");
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
  if (name === "web_fetch") {
    if (typeof parsed.url !== "string") return "web_fetch requires a string 'url' argument.";
    const purpose = typeof parsed.purpose === "string" ? parsed.purpose : undefined;
    const result = await runWebFetch(parsed.url, purpose);
    return result.ok ? result.content : result.error;
  }
  return `Unknown tool: ${name}`;
}

export type GrokChatResult = {
  text: string;
  model: string;
  finishReason: string | null;
  rounds: number;
  truncated: boolean;
};

export async function runGrokChat(params: {
  tokens: GrokTokens;
  instructions: string;
  turns: ChatTurn[];
  model?: string;
  emit: ChatEmitter;
  tools?: ToolSpec[];
  executeTool?: ToolExecutor;
}): Promise<GrokChatResult> {
  const { emit } = params;
  const tools = params.tools ?? DEFAULT_TOOLS;
  const exec = params.executeTool ?? defaultExecuteTool;
  const models = await providerModels("grok");
  const model = params.model && models.some((m) => m.id === params.model) ? params.model : DEFAULT_GROK_MODEL;
  const messages: GrokMessage[] = [
    { role: "system", content: params.instructions },
    ...params.turns.map((t) => ({ role: t.role, content: t.content }) as GrokMessage),
  ];

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

    const { text, toolCalls, finishReason } = await callGrok(params.tokens, model, messages, tools);
    lastFinishReason = finishReason;
    if (finishReason === "length") truncated = true;

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
      return {
        text: accumulated,
        model,
        finishReason: lastFinishReason,
        rounds: round + 1,
        truncated,
      };
    }

    messages.push({ role: "assistant", content: text || null, tool_calls: toolCalls });
    for (const call of toolCalls) {
      emit({
        type: "tool",
        name: call.function.name,
        path: toolTargetFromArgs(call.function.arguments),
        round: round + 1,
      });
      const output = await exec(call.function.name, call.function.arguments);
      messages.push({ role: "tool", tool_call_id: call.id, content: output });
    }
  }

  const suffix = friendlyToolBudgetNote();
  accumulated += suffix;
  emit({ type: "delta", text: suffix });
  return {
    text: accumulated,
    model,
    finishReason: "tool_round_limit",
    rounds: MAX_ROUNDS,
    truncated,
  };
}
