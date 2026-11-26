import { z } from "zod";
import { DEFAULT_WEIGHTS, PILLARS, createRanker, type CareerData, type Pillar, type Student, type Weights } from "@/lib/career-ranking";

/**
 * The student's career-ranking settings, saved on their workspace so the website, the iOS app and the
 * List tab all rank the same way: the majors they want to end up in, the weights and the adjustments.
 * Anything missing falls back: targets to the profile's intended majors, then every major; the rest to defaults.
 */

export type CareerFlags = { col: boolean; va: boolean; stretch: boolean };
export type CareerSettings = { targets?: string[]; weights?: Weights; flags?: CareerFlags };

export const CAREER_DEFAULT_FLAGS: CareerFlags = { col: true, va: false, stretch: false };

export const careerWeightsSchema = z.object(Object.fromEntries(PILLARS.map((k) => [k, z.number().min(0).max(100)])) as Record<Pillar, z.ZodNumber>)
  .refine((w) => PILLARS.some((k) => w[k] > 0));
export const careerFlagsSchema = z.object({ col: z.boolean(), va: z.boolean(), stretch: z.boolean() });
export const careerTargetsSchema = z.array(z.string().max(40)).max(40);

export const careerSettingsSchema = z.object({
  targets: careerTargetsSchema.optional(),
  weights: careerWeightsSchema.optional(),
  flags: careerFlagsSchema.optional(),
}).strict();

/** Saved settings read back from a workspace, dropping anything that no longer fits. */
export function readCareerSettings(raw: unknown): CareerSettings | null {
  const parsed = careerSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The target majors: picked ones that still exist, else the intended majors, else every major. */
export function resolveTargets(all: string[], picked: string[] | undefined, intended: string[]): string[] {
  const keep = (list: string[]) => list.filter((k) => all.includes(k));
  const fromPicked = keep(picked ?? []);
  if (fromPicked.length) return fromPicked;
  const fromIntended = keep(intended);
  return fromIntended.length ? fromIntended : all;
}

export type PathInputs = { intended: string[]; schools: { id: number; major: string[] }[]; settings: CareerSettings | null };

/**
 * Each school's My path rank on the full list (every school ranked, not just the student's own), as a number:
 * a tie "T-12" is 12. The List tab averages this rank with the published ones.
 */
export function pathRanks(data: CareerData, me: PathInputs): { id: number; rank: number }[] {
  const ranker = createRanker(data);
  const all = data.meta.majors.filter((m) => m.target).map((m) => m.key);
  const targets = resolveTargets(all, me.settings?.targets, me.intended);
  const student: Student = {
    targets,
    direct: Object.fromEntries(
      me.schools.map((s) => [s.id, s.major.filter((k) => targets.includes(k))] as const).filter(([, k]) => k.length > 0),
    ),
  };
  const st = { track: "path", ...(me.settings?.flags ?? CAREER_DEFAULT_FLAGS), w: me.settings?.weights ?? { ...DEFAULT_WEIGHTS } };
  return ranker.rank(st, student).map((r) => ({ id: r.s.id, rank: Number(String(r.rk).replace(/^T-/, "")) }));
}
