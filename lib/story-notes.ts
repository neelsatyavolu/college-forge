import type { Activity, Honor } from "./store";
import { ACTIVITY_DESC_LIMIT, MAX_ACTIVITIES, MAX_HONORS } from "./profile-fields";

const NAME_LIMIT = 200;
// A dash with a space on both sides separates a name from its details; a hyphen inside a word does not.
const SEPARATOR = /\s+[—–-]+\s+|\s*[—–]\s*/;
const BULLET = /^\s*(?:[•*·▪◦-]|\d{1,2}[.)])\s*/;

function storyLines(text: unknown): string[] {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(BULLET, "").trim())
    .filter(Boolean);
}

function splitLine(line: string): { name: string; rest: string } {
  const match = SEPARATOR.exec(line);
  if (!match || match.index === 0) return { name: line.slice(0, NAME_LIMIT).trim(), rest: "" };
  return {
    name: line.slice(0, match.index).slice(0, NAME_LIMIT).trim(),
    rest: line.slice(match.index + match[0].length).trim(),
  };
}

/**
 * Turns the onboarding story text into profile rows without AI: one activity or honor per line, the text
 * before the first dash as the name and the rest as the description. Capped at the Common App limits.
 */
export function splitStoryNotes(notes: { activities?: unknown; awards?: unknown }): { activities: Activity[]; honors: Honor[] } {
  const activities = storyLines(notes.activities)
    .slice(0, MAX_ACTIVITIES)
    .map((line, i): Activity => {
      const { name, rest } = splitLine(line);
      return { rank: i + 1, name, type: "", ...(rest ? { desc: rest.slice(0, ACTIVITY_DESC_LIMIT).trim() } : {}) };
    });
  const honors = storyLines(notes.awards)
    .slice(0, MAX_HONORS)
    .map((line): Honor => ({ title: line.slice(0, NAME_LIMIT).trim(), level: "" }));
  return { activities, honors };
}
