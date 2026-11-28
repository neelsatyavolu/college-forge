/**
 * Tops a short draft list up to the number of applications the student asked for. Writing up twenty
 * schools takes longer than one AI turn has, so when the AI proposes fewer, Forge adds the rest itself
 * from its own ranked recommendations (lib/college-recommendations.ts), filling whichever tier is
 * furthest below the student's mix first. Each added school says it was added by Forge.
 */
import type { UiSchool } from "./chat-types";
import type { Workspace } from "./store";
import { recommendColleges } from "./college-recommendations";
import { isUcCampus } from "./seed-college-list";

type Tier = UiSchool["tier"];
type Candidate = { name: string; slug: string; tier: Tier; note: string };

/** Reach and target shares by ambition; likely is the rest (same as the interview's mix rule). */
const SHARES: Record<string, [number, number]> = { ambitious: [0.4, 0.35], balanced: [0.28, 0.42], conservative: [0.15, 0.4] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const toTier = (t: unknown): Tier | null => (t === "safety" || t === "likely" ? "likely" : t === "reach" || t === "target" ? t : null);

/** The applications the student asked for (with and without supplements), or null when they gave no counts. */
export function requestedCount(ws: Workspace): number | null {
  const p = ws.onboarding.listPrefs;
  return typeof p?.suppCount === "number" && typeof p?.noSuppCount === "number" ? p.suppCount + p.noSuppCount : null;
}

/** Counts applications: every UC campus together is one. */
function apps(schools: { name: string; slug?: string }[]): number {
  return schools.filter((s) => !isUcCampus(s)).length + (schools.some((s) => isUcCampus(s)) ? 1 : 0);
}

function candidates(ws: Workspace): Candidate[] {
  const r = recommendColleges(ws, { morePerTier: 15 }) as unknown as {
    recommendations: { college: { name: string; slug: string }; fit: { tier?: string; reasons: string[] } }[];
    more?: { name: string; slug: string; tier: string; note?: string }[];
    inState?: { name: string; slug: string; tier: string; note?: string }[];
  };
  const out: Candidate[] = [];
  for (const x of r.recommendations ?? []) {
    const tier = toTier(x.fit.tier);
    if (tier) out.push({ name: x.college.name, slug: x.college.slug, tier, note: x.fit.reasons[0] ?? "" });
  }
  for (const x of [...(r.inState ?? []), ...(r.more ?? [])]) {
    const tier = toTier(x.tier);
    if (tier) out.push({ name: x.name, slug: x.slug, tier, note: x.note ?? "" });
  }
  return out;
}

/**
 * The draft with schools added from Forge's recommendations until it reaches the requested count.
 * Returns the draft unchanged when it's already long enough or there's nothing to add.
 */
export function fillToRequested(ws: Workspace, schools: UiSchool[], pool: Candidate[] = candidates(ws)): { schools: UiSchool[]; added: string[] } {
  const wanted = requestedCount(ws);
  if (!wanted || apps(schools) >= wanted) return { schools, added: [] };
  const [reachShare, targetShare] = SHARES[ws.onboarding.listPrefs?.ambition ?? "balanced"] ?? SHARES.balanced;
  const goal: Record<Tier, number> = { reach: Math.round(wanted * reachShare), target: Math.round(wanted * targetShare), likely: 0 };
  goal.likely = wanted - goal.reach - goal.target;
  const taken = new Set(schools.flatMap((s) => [norm(s.name), ...(s.slug ? [norm(s.slug)] : [])]));
  const fresh = pool.filter((c, i) => !taken.has(norm(c.name)) && !taken.has(norm(c.slug)) && pool.findIndex((d) => d.slug === c.slug) === i);
  const out = [...schools];
  const added: string[] = [];
  while (apps(out) < wanted && fresh.length) {
    const have = (t: Tier) => out.filter((s) => s.tier === t).length;
    // The tier furthest below its goal that still has candidates; then any candidate at all.
    const order = (["reach", "target", "likely"] as Tier[]).sort((a, b) => (have(a) - goal[a]) - (have(b) - goal[b]));
    const tier = order.find((t) => fresh.some((c) => c.tier === t)) ?? fresh[0].tier;
    const i = fresh.findIndex((c) => c.tier === tier);
    const [c] = fresh.splice(i, 1);
    // A second UC campus doesn't add an application, so it can't close the gap.
    if (isUcCampus(c) && out.some((s) => isUcCampus(s))) continue;
    out.push({ name: c.name, slug: c.slug, tier: c.tier, reason: `Added by Forge to reach the ${wanted} applications you asked for.${c.note ? ` ${c.note}` : ""}`.slice(0, 280) });
    added.push(c.name);
  }
  return { schools: out, added };
}
