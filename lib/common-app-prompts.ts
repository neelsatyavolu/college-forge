import type { Essay } from "./store";

/**
 * Current Common App personal-statement prompts (student picks one).
 * Word limit is 650 for the personal statement across all prompts.
 * Update each cycle when Common App publishes new prompts.
 */
export const COMMON_APP_PERSONAL_PROMPTS: Essay[] = [
  {
    id: "ca-ps-1",
    group: "Common App",
    label: "Personal statement — background",
    prompt:
      "Some students have a background, identity, interest, or talent that is so meaningful they believe their application would be incomplete without it. If this sounds like you, then please share your story.",
    limit: 650,
    unit: "words",
    starter: "",
  },
  {
    id: "ca-ps-2",
    group: "Common App",
    label: "Personal statement — lessons from obstacles",
    prompt:
      "The lessons we take from obstacles we encounter can be fundamental to later success. Recount a time when you faced a challenge, setback, or failure. How did it affect you, and what did you learn from the experience?",
    limit: 650,
    unit: "words",
    starter: "",
  },
  {
    id: "ca-ps-3",
    group: "Common App",
    label: "Personal statement — questioning a belief",
    prompt:
      "Reflect on a time when you questioned or challenged a belief or idea. What prompted your thinking? What was the outcome?",
    limit: 650,
    unit: "words",
    starter: "",
  },
  {
    id: "ca-ps-4",
    group: "Common App",
    label: "Personal statement — gratitude",
    prompt:
      "Reflect on something that someone has done for you that has made you happy or thankful in a surprising way. How has this gratitude affected or motivated you?",
    limit: 650,
    unit: "words",
    starter: "",
  },
  {
    id: "ca-ps-5",
    group: "Common App",
    label: "Personal statement — accomplishment or realization",
    prompt:
      "Discuss an accomplishment, event, or realization that sparked a period of personal growth and a new understanding of yourself or others.",
    limit: 650,
    unit: "words",
    starter: "",
  },
  {
    id: "ca-ps-6",
    group: "Common App",
    label: "Personal statement — topic of your choice",
    prompt: "Share an essay on any topic of your choice. It can be one you've already written, one that responds to a different prompt, or one of your own design.",
    limit: 650,
    unit: "words",
    starter: "",
  },
  {
    id: "ca-additional-info",
    group: "Common App",
    label: "Additional information (optional)",
    prompt:
      "Do you wish to provide details of circumstances or qualifications not reflected in the application? Optional — use only for material the rest of the app cannot capture. (First-year limit: 300 words.)",
    // Reduced from 650 → 300 for first-year apps as of 2025–26 cycle (Common App announcement).
    limit: 300,
    unit: "words",
    starter: "",
  },
];

/** Official Common App Activities limits (confirmed via Common App FY Activities resource). */
export const ACTIVITY_DESC_CHARS = 150;
export const ACTIVITY_POSITION_CHARS = 50;
export const ACTIVITY_ORG_CHARS = 100;
export const MAX_ACTIVITIES = 10;
export const MAX_HONORS = 5;
export const HONOR_TITLE_CHARS = 100;
/** Personal statement range: min 250, max 650 words. */
export const PERSONAL_STATEMENT_MIN = 250;
export const PERSONAL_STATEMENT_MAX = 650;
