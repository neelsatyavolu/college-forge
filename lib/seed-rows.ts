import type { College } from "./store";

const SEED_TAGS = new Set(["Fair-ranking evidence", "In-state"]);
/**
 * Every field the list builder writes on a row, plus `supp` (derived from the essay prompts) and `priority`
 * (set false on every row when another school is starred). A row with any other field was edited by hand.
 */
const SEED_FIELDS = new Set(["slug", "name", "short", "scorecardId", "location", "setting", "photo", "tier", "verdict", "admit", "satRange", "netPrice", "tags", "supp", "priority"]);

/**
 * Whether the automatic list builder may replace this row. Rows saved before `origin` existed carry no
 * origin; those count as seeded only when they look exactly like a builder row: its tags and its fields.
 */
export function isSeededRow(c: College): boolean {
  if (c.priority) return false;
  if (c.origin) return c.origin === "seed";
  const tags = c.tags || [];
  return tags.some(t => t.label === "Fair-ranking evidence") && tags.every(t => SEED_TAGS.has(t.label))
    && Object.keys(c).every(k => SEED_FIELDS.has(k));
}
