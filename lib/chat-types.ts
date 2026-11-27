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

/** A question the onboarding AI asked, drawn as tiles (or an upload / number / school picker). */
export type UiQuestion = {
  id: string;
  kind: "single" | "multi" | "upload" | "number" | "school_search" | "confirm" | "activities" | "intake";
  prompt: string;
  options?: { value: string; label: string; hint?: string }[];
  min?: number;
  max?: number;
  allowOther?: boolean;
};
/** A school on the draft list the student approves. "likely" is stored as tier "safety". */
export type UiSchool = {
  slug?: string;
  name: string;
  tier: "reach" | "target" | "likely";
  reason: string;
  estChance?: string;
  netPrice?: string;
  fitsBudget?: "yes" | "no" | "unknown";
  /** Already on the student's list before this draft. */
  current?: boolean;
  /** The round the AI plans for this school (ED I, ED II, EA, REA, RD, Rolling); confirmed after research. */
  round?: string;
  /** Whether the application needs supplemental essays ("yes" for UC: the Personal Insight Questions). */
  supplements?: "yes" | "no" | "unknown";
  /** The AI's tier, kept when Forge's data put the school in a different one. */
  aiTier?: "reach" | "target" | "likely";
};
/** An early-round idea shown with the draft list; the final plan comes after research. */
export type UiEdIdea = { school?: string; reason: string };
/** A community-college start with a transfer agreement into a four-year college: a low-cost backstop. */
export type UiTransferPath = { college: string; transfersTo: string; reason: string };
/** rounds: the round the AI recommends at every school on the list (ED I, ED II, EA, REA, RD, Rolling). */
export type UiStrategy = { ed?: string; ea: string[]; reasons: string; rounds?: { school: string; round: string; deadline?: string }[] };
export type ResearchStage = "searching" | "reading" | "saved" | "done" | "needs_review";

export type ChatEvent =
  | { type: "status"; stage: ChatStage; message: string; round?: number }
  | { type: "question"; question: UiQuestion }
  | { type: "list"; schools: UiSchool[]; edIdea?: UiEdIdea; transferPath?: UiTransferPath; warning?: string }
  | { type: "strategy"; strategy: UiStrategy }
  | { type: "research"; slug: string; name: string; stage: ResearchStage; facts?: number }
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
