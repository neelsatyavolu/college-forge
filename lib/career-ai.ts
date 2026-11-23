import { z } from "zod";

/**
 * A student's own judged ranking ("AI My Path"): an order and a reason for each school, made outside Forge and
 * loaded from a JSON file. It is private to the signed-in account and kept outside the workspace document, so
 * share links, exports and AI context never include it. Schools are matched to the career ranking by name.
 */
export const careerAiSchema = z.object({
  about: z.string().max(3000).default(""),
  made: z.string().max(60).default(""),
  list: z
    .array(
      z.object({
        school: z.string().trim().min(1).max(100),
        rank: z.string().regex(/^(T-)?\d{1,3}$/),
        why: z.string().max(1500).default(""),
      }),
    )
    .min(1)
    .max(300),
});

export type CareerAi = z.infer<typeof careerAiSchema>;

/** Largest file accepted, in characters. A 51-school list is about 17,000. */
export const CAREER_AI_MAX_CHARS = 200_000;

/** The list from stored or uploaded text, or null when it is not a valid list. */
export function parseCareerAi(text: string | null): CareerAi | null {
  if (!text || text.length > CAREER_AI_MAX_CHARS) return null;
  try {
    const parsed = careerAiSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
