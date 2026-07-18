export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ProviderName = "codex" | "grok" | "opencode";

/**
 * Progress + output events streamed from POST /api/ai/chat as newline-
 * delimited JSON (one JSON object per line). The client renders the answer
 * and a live progress trace from these as they arrive, instead of waiting
 * for the whole reply to finish server-side.
 */
export type ChatStage =
  | "context"
  | "thinking"
  | "reasoning"
  | "round"
  | "tool"
  | "writing";

export type ChatEvent =
  | { type: "status"; stage: ChatStage; message: string; round?: number }
  | { type: "tool"; name: string; path?: string; round: number }
  | { type: "delta"; text: string }
  | { type: "error"; message: string; detail?: string }
  | {
      type: "done";
      provider: ProviderName;
      model?: string;
      rounds: number;
      finishReason: string | null;
      truncated: boolean;
      textLength: number;
      elapsedMs: number;
    };

/** Sink the provider modules call to report progress and stream output. */
export type ChatEmitter = (event: ChatEvent) => void;

/** An OpenAI-style function tool schema exposed to the model. */
export type ToolSpec = {
  name: string;
  description: string;
  parameters: unknown;
};

/**
 * Executes a tool call and returns the string the model sees as the tool
 * result. Injected by the API route so the same provider clients can be given
 * read-only tools, workspace-mutating tools, or anything else.
 */
export type ToolExecutor = (name: string, argsJson: string) => Promise<string>;
