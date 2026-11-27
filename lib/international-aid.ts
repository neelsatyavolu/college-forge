/**
 * Institutional aid to international (nonresident) undergraduates, from each college's Common Data Set
 * section H6, collected by scripts/research/intl-aid.mjs. An average award is not a promise to any one
 * student, so Forge shows it as context and uses it only to rule out colleges that report aiding none.
 */
import data from "../public/data/international-aid.json";

export type InternationalAid = {
  needBased: boolean;
  meritBased: boolean;
  none: boolean;
  awarded: number | null;
  average: number | null;
  cdsYear: string | null;
  source: string;
};

const COLLEGES = (data as { colleges: Record<string, InternationalAid> }).colleges;

export function internationalAid(slug: string | undefined | null): InternationalAid | null {
  return (slug && COLLEGES[slug]) || null;
}

/** True when the college's CDS says it gives international undergraduates no institutional aid. */
export function aidsNoInternationals(aid: InternationalAid | null): boolean {
  if (!aid || aid.needBased || aid.meritBased || (aid.average ?? 0) > 0 || (aid.awarded ?? 0) > 0 && aid.none) return false;
  return aid.none || aid.awarded === 0;
}

/** One line for the student: how many international undergraduates got aid and the average award. */
export function internationalAidLabel(aid: InternationalAid | null): string | null {
  if (!aid) return null;
  if (aidsNoInternationals(aid)) return "reports no institutional aid to international students";
  if (aid.awarded && aid.average) return `${aid.awarded.toLocaleString("en-US")} international students got aid averaging $${aid.average.toLocaleString("en-US")}${aid.cdsYear ? ` (CDS ${aid.cdsYear})` : ""}`;
  return null;
}
