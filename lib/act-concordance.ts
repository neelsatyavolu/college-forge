/**
 * ACT composite to SAT total, from the 2018 ACT/College Board concordance tables
 * (single-point SAT equivalents). The tables publish no concordance below ACT 9.
 */
const ACT_TO_SAT: Readonly<Record<number, number>> = {
  36: 1590, 35: 1540, 34: 1500, 33: 1460, 32: 1430, 31: 1400, 30: 1370,
  29: 1340, 28: 1310, 27: 1280, 26: 1240, 25: 1210, 24: 1180, 23: 1140,
  22: 1110, 21: 1080, 20: 1040, 19: 1010, 18: 970, 17: 930, 16: 890,
  15: 850, 14: 800, 13: 760, 12: 710, 11: 670, 10: 630, 9: 590,
};

/** The concorded SAT total for a whole-number ACT composite, or null when the table has no entry. */
export function actToSat(act: number): number | null {
  return Number.isInteger(act) ? ACT_TO_SAT[act] ?? null : null;
}
