/**
 * User-facing progress copy for the copilot stream.
 * Keep free of engine jargon (rounds, tool names, finish reasons).
 */

const ROUND_MESSAGES = [
  "Thinking…",
  "Looking things up…",
  "Putting it together…",
  "Still working…",
  "Almost there…",
  "Finishing touches…",
  "Double-checking…",
  "Wrapping up…",
  "One more step…",
  "Nearly done…",
];

/** Progress line for tool-loop rounds (1-based). */
export function friendlyRoundMessage(round: number): string {
  if (round <= 1) return ROUND_MESSAGES[0];
  const idx = Math.min(round - 1, ROUND_MESSAGES.length - 1);
  return ROUND_MESSAGES[idx];
}

export function friendlyWritingMessage(): string {
  return "Writing a reply…";
}

export function friendlyThinkingMessage(): string {
  return "Thinking it through…";
}

export function friendlyContextMessage(): string {
  return "Loading your hub…";
}

export function friendlyCutOffNote(): string {
  return "\n\n_(This reply got cut short — try a shorter or more specific question.)_";
}

export function friendlyToolBudgetNote(): string {
  return "\n\n_(That took a lot of steps — ask a follow-up if you need more.)_";
}

/** Map hub tool name (+ optional path/query) to a short status line. */
export function friendlyToolMessage(name: string, path?: string): string {
  const detail = path && path.length < 60 ? path : path ? `${path.slice(0, 48)}…` : "";
  switch (name) {
    case "web_search":
      return detail ? `Searching the web for “${detail}”…` : "Searching the web…";
    case "web_fetch":
      return detail ? `Reading page ${detail}…` : "Reading a web page…";
    case "read_upload":
    case "read_file":
      return detail ? `Reading ${detail}…` : "Reading your file…";
    case "set_applicant_snapshot":
      return "Updating your overview snapshot…";
    case "set_profile_identity":
      return "Saving your profile…";
    case "set_testing":
      return "Saving test scores…";
    case "set_coursework":
      return "Saving coursework…";
    case "set_activities":
      return "Saving activities…";
    case "set_honors":
      return "Saving awards & honors…";
    case "upsert_college":
      return detail ? `Updating ${detail}…` : "Updating your school list…";
    case "remove_college":
      return "Updating your school list…";
    case "set_early_decision":
      return "Setting early-decision school…";
    case "set_critical_dates":
      return "Updating important dates…";
    case "set_essays":
      return "Updating essay prompts…";
    case "set_recommendations":
      return "Updating recommenders…";
    case "set_scholarships":
      return "Updating scholarships…";
    case "set_financial_aid":
      return "Updating financial aid…";
    case "set_application_status":
      return "Updating application status…";
    default:
      return "Updating your hub…";
  }
}
