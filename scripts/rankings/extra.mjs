/**
 * Parsers for the two lists the List tab adds to its weighted average:
 * the WSJ/College Pulse top 100 (as republished by Poets&Quants, since
 * wsj.com sends the full table only to subscribers) and the Princeton
 * Review's Top 50 Best Value Colleges, public and private.
 */

export const PRINCETON_REVIEW_URL = (kind, page) =>
  `https://www.princetonreview.com/college-rankings?rankings=top-50-best-value-colleges-${kind}-schools${page > 1 ? `&page=${page}` : ""}`;

const text = (html) =>
  String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&#039;|&apos;/g, "’")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The name the way students write it on an application, so the List tab can
 * match it: drops "(UT)"-style state tags and SUNY/CUNY system prefixes,
 * and names Harvard College as Harvard University.
 */
export function cleanName(name) {
  return String(name)
    .replace(/\s*\((?:[A-Z]{2})\)$/, "")
    .replace(/^(?:State University of New York|City University of New York)\s*[-–—]\s*/i, "")
    .replace(/,\s*CUNY$/i, "")
    .replace(/\bA\s*&\s*M\b/g, "A&M")
    .replace(/\bUniv\.(?=\s|,|$)/g, "University")
    .replace(/^Harvard College$/, "Harvard University")
    .replace(/\s+/g, " ")
    .trim();
}

/** One Princeton Review rankings page: [{rank, name, place}] in page order. */
export function parsePrincetonReview(html) {
  const out = [];
  const re = /class="ranked-box"><span>#(\d+)<\/span>[\s\S]*?<h2><a [^>]*>([^<]+)<\/a><\/h2>(?:[\s\S]*?<span class="black-text">([^<]*)<\/span>)?/g;
  for (const m of String(html).matchAll(re)) {
    out.push({ rank: Number(m[1]), name: cleanName(text(m[2])), place: m[3] ? text(m[3]) : null });
  }
  return out;
}

/** The "Wall Street Journal/College Pulse Top 100" table in a Poets&Quants article: [{rank, name}]. */
export function parseWsjTable(html) {
  const tables = String(html).match(/<table[\s\S]*?<\/table>/g) || [];
  const table = tables.find((t) => /College Pulse Top 100/i.test(text(t)));
  if (!table) return [];
  const out = [];
  for (const row of table.match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const cells = (row.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || []).map(text);
    const rank = Number(cells[0]);
    if (Number.isInteger(rank) && rank > 0 && cells[1]) out.push({ rank, name: cleanName(cells[1]) });
  }
  return out;
}

/** Checks a list runs 1..n with no gaps (ties may repeat a rank). */
export function checkList(list, n, label) {
  if (list.length < n) throw new Error(`${label}: only ${list.length} schools, expected ${n}`);
  list.forEach((s, i) => {
    if (i && s.rank < list[i - 1].rank) throw new Error(`${label}: ranks out of order at ${s.name}`);
  });
  return list;
}
