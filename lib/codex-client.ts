import { CODEX_BACKEND_BASE, type CodexTokens } from "./codex-oauth";
import { providerModels } from "./ai-models";
import type { ChatTurn, ChatEmitter, ToolSpec, ToolExecutor } from "./chat-types";
import { READ_FILE_TOOL, readContextFile } from "./file-tool";
import { WEB_SEARCH_TOOL, WEB_FETCH_TOOL, runWebSearch, runWebFetch } from "./web-search-tool";
import {
  friendlyRoundMessage,
  friendlyWritingMessage,
  friendlyThinkingMessage,
  friendlyCutOffNote,
  friendlyToolBudgetNote,
} from "./chat-status";

export const DEFAULT_CODEX_MODEL = process.env.CODEX_MODEL ?? "gpt-5.6-sol";
const MAX_ROUNDS = 6;
// A single reasoning-model round should never legitimately need this long.
// If the ChatGPT backend stalls past this we abort with a clear error,
// instead of leaving the request (and the user's spinner) hanging forever.
const UPSTREAM_TIMEOUT_MS = 90_000;

/** GPT-5.5+ reasoning models need a low effort setting on the Codex backend. */
function isReasoningCodexModel(model: string): boolean {
  return model.startsWith("gpt-5.5") || model.startsWith("gpt-5.6") || model.startsWith("gpt-6");
}

type InputItem =
  | { role: "user" | "assistant"; content: { type: string; text: string }[] }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

type FunctionCall = { call_id: string; name: string; arguments: string };

function turnsToInput(turns: ChatTurn[]): InputItem[] {
  return turns.map((t) => ({
    role: t.role,
    content: [
      { type: t.role === "assistant" ? "output_text" : "input_text", text: t.content },
    ],
  }));
}

// Short label shown in the progress trace for a tool call — a file path for
// read_file, or the query for web_search.
function toolTargetFromArgs(args: string | undefined): string | undefined {
  try {
    const parsed = JSON.parse(args || "{}");
    if (parsed && typeof parsed.path === "string") return parsed.path;
    if (parsed && typeof parsed.query === "string") return parsed.query;
    if (parsed && typeof parsed.url === "string") return parsed.url;
  } catch {
    // ignore — the tool event is still useful without a target
  }
  return undefined;
}

async function callCodex(
  tokens: CodexTokens,
  model: string,
  instructions: string,
  input: InputItem[],
  emit: ChatEmitter,
  round: number,
  hasPriorText: boolean,
  tools: ToolSpec[]
): Promise<{ text: string; toolCalls: FunctionCall[]; finishReason: string | null }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${tokens.accessToken}`,
    originator: "codex_cli_rs",
    "openai-beta": "responses=v1",
  };
  if (tokens.accountId) headers["chatgpt-account-id"] = tokens.accountId;

  const body: Record<string, unknown> = {
    model,
    instructions,
    input,
    tools: tools.map((t) => ({ type: "function", ...t })),
    stream: true,
    store: false,
  };
  if (isReasoningCodexModel(model)) {
    // chatgpt.com/backend-api/codex/responses rejects max_output_tokens
    // ("Unsupported parameter"), so we rely on a low reasoning effort to
    // leave the model's plan-budget for the visible answer instead of
    // burning it on hidden thinking tokens.
    body.reasoning = { effort: "low" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${CODEX_BACKEND_BASE}/responses`, {
      method: "POST",
      headers: { ...headers, accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Codex backend timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s on round ${round}.`
      );
    }
    throw new Error(
      `Codex backend request failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok || !res.body) {
    clearTimeout(timer);
    const detail = await res.text().catch(() => "");
    throw new Error(`Codex backend failed (${res.status}): ${detail.slice(0, 400)}`);
  }

  try {
    return await parseCodexStream(res.body, emit, round, hasPriorText);
  } finally {
    clearTimeout(timer);
  }
}

async function parseCodexStream(
  body: ReadableStream<Uint8Array>,
  emit: ChatEmitter,
  round: number,
  hasPriorText: boolean
): Promise<{ text: string; toolCalls: FunctionCall[]; finishReason: string | null }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamedText = "";
  const toolCalls: FunctionCall[] = [];
  let finalResponse: unknown = null;
  let failureMessage: string | null = null;
  let finishReason: string | null = null;

  // Streaming bookkeeping: whether we've emitted the first answer delta yet,
  // and a throttled buffer for the model's reasoning summary.
  let firstTextEmitted = false;
  let reasoningBuf = "";
  let lastReasoningEmit = 0;

  const handleEvent = (eventType: string, dataJson: string) => {
    if (!dataJson || dataJson === "[DONE]") return;
    let payload: unknown;
    try {
      payload = JSON.parse(dataJson);
    } catch {
      return;
    }

    if (eventType === "response.output_text.delta") {
      const p = payload as { delta?: unknown };
      if (typeof p.delta === "string" && p.delta) {
        streamedText += p.delta;
        let out = p.delta;
        if (!firstTextEmitted) {
          firstTextEmitted = true;
          emit({ type: "status", stage: "writing", message: friendlyWritingMessage(), round });
          // Round 1's text follows earlier rounds' text — keep the blank
          // line between segments so the client renders them apart.
          if (hasPriorText) out = "\n\n" + out;
        }
        emit({ type: "delta", text: out });
      }
      return;
    }

    if (
      eventType === "response.reasoning_summary_text.delta" ||
      eventType === "response.reasoning_text.delta"
    ) {
      const p = payload as { delta?: unknown };
      if (typeof p.delta === "string") {
        reasoningBuf += p.delta;
        const now = Date.now();
        // Reasoning deltas are tiny and frequent — emit a rolling snippet a
        // few times a second rather than one event per token.
        if (now - lastReasoningEmit > 250) {
          lastReasoningEmit = now;
          const snippet = reasoningBuf.replace(/\s+/g, " ").trim().slice(-140);
          if (snippet) {
            emit({ type: "status", stage: "reasoning", message: friendlyThinkingMessage(), round });
          }
        }
      }
      return;
    }

    if (eventType === "response.output_item.done") {
      const p = payload as {
        item?: {
          type?: string;
          call_id?: string;
          name?: string;
          arguments?: string;
          content?: { type?: string; text?: string }[];
        };
      };
      const item = p.item;
      if (item?.type === "function_call" && item.call_id && item.name) {
        toolCalls.push({
          call_id: item.call_id,
          name: item.name,
          arguments: item.arguments ?? "{}",
        });
        emit({
          type: "tool",
          name: item.name,
          path: toolTargetFromArgs(item.arguments),
          round,
        });
      } else if (item?.type === "message" && Array.isArray(item.content)) {
        // Backend delivered the message as a whole item rather than as
        // deltas — emit it once so the client still sees the answer.
        let msgText = "";
        for (const c of item.content) {
          if (c.type === "output_text" && typeof c.text === "string") msgText += c.text;
        }
        if (msgText && !streamedText) {
          emit({
            type: "delta",
            text: hasPriorText && !firstTextEmitted ? "\n\n" + msgText : msgText,
          });
          firstTextEmitted = true;
          streamedText += msgText;
        }
      }
      return;
    }

    if (eventType === "response.completed") {
      const p = payload as {
        response?: {
          status?: string;
          incomplete_details?: { reason?: string };
        };
      };
      if (p.response) finalResponse = p.response;
      if (p.response?.status === "incomplete") {
        finishReason = p.response.incomplete_details?.reason ?? "incomplete";
      } else if (p.response?.status) {
        finishReason = p.response.status;
      }
      return;
    }

    if (eventType === "response.failed" || eventType === "error") {
      const p = payload as {
        error?: { message?: string };
        response?: { error?: { message?: string } };
        message?: string;
      };
      failureMessage =
        p.error?.message ?? p.response?.error?.message ?? p.message ?? "Codex stream failed.";
    }
  };

  const flushBlock = (rawBlock: string) => {
    if (!rawBlock.trim()) return;
    let eventType = "message";
    const dataLines: string[] = [];
    for (const line of rawBlock.split("\n")) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length > 0) handleEvent(eventType, dataLines.join("\n"));
  };

  while (true) {
    let chunk: Awaited<ReturnType<typeof reader.read>>;
    try {
      chunk = await reader.read();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Codex stream timed out mid-response on round ${round}.`);
      }
      throw err;
    }
    if (chunk.done) break;
    // Normalize CRLF so the \n\n delimiter is reliable across servers.
    buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      flushBlock(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }
  if (buffer.trim()) flushBlock(buffer);

  if (failureMessage) {
    throw new Error(`Codex stream failed: ${failureMessage}`);
  }

  if (streamedText || toolCalls.length > 0) {
    return { text: streamedText, toolCalls, finishReason };
  }
  if (finalResponse) {
    const parsed = parseCodexOutput(finalResponse);
    // Non-streamed fallback path — nothing was emitted live, so emit now.
    if (parsed.text) {
      emit({ type: "delta", text: hasPriorText ? "\n\n" + parsed.text : parsed.text });
    }
    for (const tc of parsed.toolCalls) {
      emit({ type: "tool", name: tc.name, path: toolTargetFromArgs(tc.arguments), round });
    }
    return { ...parsed, finishReason };
  }
  throw new Error("Codex stream ended without any output.");
}

function parseCodexOutput(json: unknown): { text: string; toolCalls: FunctionCall[] } {
  const data = json as {
    output?: {
      type?: string;
      role?: string;
      call_id?: string;
      name?: string;
      arguments?: string;
      content?: { type?: string; text?: string }[];
    }[];
  };
  let text = "";
  const toolCalls: FunctionCall[] = [];
  for (const item of data.output ?? []) {
    if (item.type === "function_call" && item.call_id && item.name) {
      toolCalls.push({
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments ?? "{}",
      });
    } else if (item.type === "message" || item.role === "assistant") {
      for (const c of item.content ?? []) {
        if (c.type === "output_text" && typeof c.text === "string") text += c.text;
      }
    }
  }
  return { text, toolCalls };
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

export type CodexChatResult = {
  text: string;
  model: string;
  finishReason: string | null;
  rounds: number;
  truncated: boolean;
};

export async function runCodexChat(params: {
  tokens: CodexTokens;
  instructions: string;
  turns: ChatTurn[];
  model?: string;
  emit: ChatEmitter;
  tools?: ToolSpec[];
  executeTool?: ToolExecutor;
}): Promise<CodexChatResult> {
  const { emit } = params;
  const tools = params.tools ?? DEFAULT_TOOLS;
  const exec = params.executeTool ?? defaultExecuteTool;
  const models = await providerModels("codex");
  const model = params.model && models.some((m) => m.id === params.model) ? params.model : DEFAULT_CODEX_MODEL;
  const input: InputItem[] = turnsToInput(params.turns);
  let accumulated = "";
  let lastFinishReason: string | null = null;
  let truncated = false;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    emit({
      type: "status",
      stage: round === 0 ? "thinking" : "round",
      message: friendlyRoundMessage(round + 1),
      round: round + 1,
    });

    const { text, toolCalls, finishReason } = await callCodex(
      params.tokens,
      model,
      params.instructions,
      input,
      emit,
      round + 1,
      accumulated.length > 0,
      tools
    );
    lastFinishReason = finishReason;
    if (text) accumulated += (accumulated ? "\n\n" : "") + text;
    if (finishReason === "max_output_tokens" || finishReason === "incomplete") truncated = true;

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

    for (const call of toolCalls) {
      input.push({
        type: "function_call",
        call_id: call.call_id,
        name: call.name,
        arguments: call.arguments,
      });
      const output = await exec(call.name, call.arguments);
      input.push({ type: "function_call_output", call_id: call.call_id, output });
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
