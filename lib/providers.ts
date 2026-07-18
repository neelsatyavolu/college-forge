import { getActiveCodexSession } from "./codex-session";
import { CODEX_MODELS, DEFAULT_CODEX_MODEL, runCodexChat } from "./codex-client";
import { getActiveGrokSession } from "./grok-session";
import { DEFAULT_GROK_MODEL, GROK_MODELS, runGrokChat } from "./grok-client";
import {
  DEFAULT_OPENCODE_MODEL,
  OPENCODE_MODELS,
  getOpencodeKey,
  runOpencodeChat,
} from "./opencode-client";
import type { ChatTurn, ChatEmitter, ProviderName, ToolSpec, ToolExecutor } from "./chat-types";
import { isWebSearchAvailable, webSearchProviderLabel } from "./web-search-tool";

export type { ChatTurn, ChatEmitter, ProviderName, ToolSpec, ToolExecutor };

export type ProviderStatus = {
  codexConnected: boolean;
  grokConnected: boolean;
  opencodeAvailable: boolean;
  active: ProviderName | null;
  codexModels: { id: string; label: string; tier: string }[];
  defaultCodexModel: string;
  grokModels: { id: string; label: string; tier: string }[];
  defaultGrokModel: string;
  opencodeModels: { id: string; label: string; tier: string }[];
  defaultOpencodeModel: string;
  /** Copilot can call web_search when EXA_API_KEY is set. */
  webSearchAvailable: boolean;
  webSearchProvider: "exa" | "none";
};

export async function resolveProviderStatus(): Promise<ProviderStatus> {
  const session = await getActiveCodexSession();
  const grokSession = await getActiveGrokSession();
  const codexConnected = Boolean(session);
  const grokConnected = Boolean(grokSession);
  const opencodeAvailable = Boolean(getOpencodeKey());
  const active: ProviderName | null = grokConnected
    ? "grok"
    : codexConnected
      ? "codex"
      : opencodeAvailable
        ? "opencode"
        : null;
  return {
    codexConnected,
    grokConnected,
    opencodeAvailable,
    active,
    codexModels: CODEX_MODELS.map((m) => ({ id: m.id, label: m.label, tier: m.tier })),
    defaultCodexModel: DEFAULT_CODEX_MODEL,
    grokModels: GROK_MODELS.map((m) => ({ id: m.id, label: m.label, tier: m.tier })),
    defaultGrokModel: DEFAULT_GROK_MODEL,
    opencodeModels: OPENCODE_MODELS.map((m) => ({ id: m.id, label: m.label, tier: m.tier })),
    defaultOpencodeModel: DEFAULT_OPENCODE_MODEL,
    webSearchAvailable: isWebSearchAvailable(),
    webSearchProvider: webSearchProviderLabel(),
  };
}

export type RunChatResult = {
  text: string;
  provider: ProviderName;
  model?: string;
  finishReason: string | null;
  rounds: number;
  truncated: boolean;
};

export async function runChat(params: {
  instructions: string;
  turns: ChatTurn[];
  preferred?: ProviderName;
  codexModel?: string;
  grokModel?: string;
  opencodeModel?: string;
  emit: ChatEmitter;
  tools?: ToolSpec[];
  executeTool?: ToolExecutor;
}): Promise<RunChatResult> {
  const session = await getActiveCodexSession();
  const grokSession = await getActiveGrokSession();
  const apiKey = getOpencodeKey();

  const wantOpencode = params.preferred === "opencode" && apiKey;
  const wantCodex = params.preferred === "codex" && session;
  const wantGrok = params.preferred === "grok" && grokSession;

  const runOpencode = async (): Promise<RunChatResult> => {
    const model = params.opencodeModel ?? DEFAULT_OPENCODE_MODEL;
    const result = await runOpencodeChat({
      apiKey: apiKey!,
      instructions: params.instructions,
      turns: params.turns,
      model,
      emit: params.emit,
    });
    return {
      text: result.text,
      provider: "opencode",
      model,
      finishReason: result.finishReason,
      rounds: result.rounds,
      truncated: result.truncated,
    };
  };

  const runCodex = async (tokens: NonNullable<typeof session>): Promise<RunChatResult> => {
    const result = await runCodexChat({
      tokens,
      instructions: params.instructions,
      turns: params.turns,
      model: params.codexModel,
      emit: params.emit,
      tools: params.tools,
      executeTool: params.executeTool,
    });
    return {
      text: result.text,
      provider: "codex",
      model: result.model,
      finishReason: result.finishReason,
      rounds: result.rounds,
      truncated: result.truncated,
    };
  };

  const runGrok = async (tokens: NonNullable<typeof grokSession>): Promise<RunChatResult> => {
    const result = await runGrokChat({
      tokens,
      instructions: params.instructions,
      turns: params.turns,
      model: params.grokModel,
      emit: params.emit,
      tools: params.tools,
      executeTool: params.executeTool,
    });
    return {
      text: result.text,
      provider: "grok",
      model: result.model,
      finishReason: result.finishReason,
      rounds: result.rounds,
      truncated: result.truncated,
    };
  };

  if (wantOpencode) return runOpencode();
  if (wantCodex) return runCodex(session!);
  if (wantGrok) return runGrok(grokSession!);
  if (grokSession) return runGrok(grokSession);
  if (session) return runCodex(session);
  if (apiKey) return runOpencode();

  throw new Error(
    "No AI provider available. Connect Grok, connect ChatGPT, or set OPENCODE_API_KEY in website/.env.local."
  );
}
