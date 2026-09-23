import { getActiveCodexSession } from "./codex-session";
import { DEFAULT_CODEX_MODEL, runCodexChat } from "./codex-client";
import { getActiveGrokSession } from "./grok-session";
import { DEFAULT_GROK_MODEL, runGrokChat } from "./grok-client";
import { providerModels } from "./ai-models";
import {
  DEFAULT_OPENCODE_MODEL,
  OPENCODE_MODELS,
  getOpencodeKey,
  runOpencodeChat,
} from "./opencode-client";
import type { ChatTurn, ChatEmitter, ProviderName, ToolSpec, ToolExecutor } from "./chat-types";
import {
  isWebSearchAvailable,
  isWebFetchAvailable,
  webSearchProviderLabel,
} from "./web-search-tool";

export type { ChatTurn, ChatEmitter, ProviderName, ToolSpec, ToolExecutor };

export type ProviderStatus = {
  codexConnected: boolean;
  grokConnected: boolean;
  opencodeAvailable: boolean;
  active: ProviderName | null;
  connectionErrors: Partial<Record<ProviderName, string>>;
  codexModels: { id: string; label: string; tier: string }[];
  defaultCodexModel: string;
  grokModels: { id: string; label: string; tier: string }[];
  defaultGrokModel: string;
  opencodeModels: { id: string; label: string; tier: string }[];
  defaultOpencodeModel: string;
  /** Copilot can call web_search when EXA and/or TinyFish is configured. */
  webSearchAvailable: boolean;
  webSearchProvider: "exa+tinyfish" | "exa" | "tinyfish" | "none";
  /** Full-page fetch via TinyFish (web_fetch tool). */
  webFetchAvailable: boolean;
};

async function connections(preferred?: ProviderName) {
  const [codex, grok] = await Promise.allSettled([
    preferred && preferred !== "codex" ? Promise.resolve(null) : getActiveCodexSession(),
    preferred && preferred !== "grok" ? Promise.resolve(null) : getActiveGrokSession(),
  ]);
  const connectionErrors: Partial<Record<ProviderName, string>> = {};
  if (codex.status === "rejected") connectionErrors.codex = "ChatGPT connection could not be refreshed. Retry or reconnect in Settings.";
  if (grok.status === "rejected") connectionErrors.grok = "Grok connection could not be refreshed. Retry or reconnect in Settings.";
  return {
    session: codex.status === "fulfilled" ? codex.value : null,
    grokSession: grok.status === "fulfilled" ? grok.value : null,
    connectionErrors,
  };
}

export async function resolveProviderStatus(): Promise<ProviderStatus> {
  const { session, grokSession, connectionErrors } = await connections();
  const codexConnected = Boolean(session);
  const grokConnected = Boolean(grokSession);
  const opencodeAvailable = Boolean(getOpencodeKey());
  const [codexModels, grokModels] = await Promise.all([providerModels("codex"), providerModels("grok")]);
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
    connectionErrors,
    codexModels: codexModels.map((m) => ({ id: m.id, label: m.label, tier: m.tier ?? "" })),
    defaultCodexModel: codexModels.find((m) => m.id === DEFAULT_CODEX_MODEL)?.id ?? codexModels[0]?.id ?? DEFAULT_CODEX_MODEL,
    grokModels: grokModels.map((m) => ({ id: m.id, label: m.label, tier: m.tier ?? "" })),
    defaultGrokModel: grokModels.find((m) => m.id === DEFAULT_GROK_MODEL)?.id ?? grokModels[0]?.id ?? DEFAULT_GROK_MODEL,
    opencodeModels: OPENCODE_MODELS.map((m) => ({ id: m.id, label: m.label, tier: m.tier })),
    defaultOpencodeModel: DEFAULT_OPENCODE_MODEL,
    webSearchAvailable: isWebSearchAvailable(),
    webSearchProvider: webSearchProviderLabel(),
    webFetchAvailable: isWebFetchAvailable(),
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
  const { session, grokSession, connectionErrors } = await connections(params.preferred);
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

  if (params.preferred && !wantOpencode && !wantCodex && !wantGrok) {
    const label = params.preferred === "codex" ? "ChatGPT" : params.preferred === "grok" ? "Grok" : "OpenCode";
    throw new Error(connectionErrors[params.preferred] || `${label} is not connected or available. Connect it in Settings or choose Auto. Your message was not sent to another provider.`);
  }
  if (wantOpencode) return runOpencode();
  if (wantCodex) return runCodex(session!);
  if (wantGrok) return runGrok(grokSession!);
  if (grokSession) return runGrok(grokSession);
  if (session) return runCodex(session);
  if (apiKey) return runOpencode();

  throw new Error(Object.values(connectionErrors).join(" ") || "No AI provider available. Connect Grok or ChatGPT in Settings to use the copilot.");
}
