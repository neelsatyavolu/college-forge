import { CHECKED } from "./checked";
import { CALIFORNIA } from "./california";
import { CAMPUS } from "./campus";
import { LAC } from "./lac";
import { SLATE } from "./slate";
import type { College } from "./types";

export { PLATFORM_LABEL, type College, type Platform } from "./types";

/** Every school the app knows, by name. */
export const COLLEGES: College[] = [...CHECKED, ...SLATE, ...CALIFORNIA, ...CAMPUS, ...LAC].sort((a, b) => a.name.localeCompare(b.name));

/** The best-known names, for the landing page. */
const FAMOUS = [
  "harvard", "stanford", "mit", "yale", "princeton", "columbia", "upenn", "brown", "cornell", "dartmouth", "caltech", "uchicago",
  "duke", "northwestern", "berkeley", "ucla", "umich", "usc", "georgetown", "notredame", "vanderbilt", "rice", "uva", "unc",
];

/** Every other catalog school, each with a logo file. Schools added by link show a monogram. */
const MORE_LOGOS = [
  "adelphi", "agnesscott", "alabama", "albany", "american", "amherst", "arizona", "auburn", "azusa", "ballstate", "bard", "barnard",
  "bates", "baylor", "bc", "belmont", "berea", "bgsu", "biola", "boisestate", "bowdoin", "brynmawr", "bu", "bucknell", "byu", "calpoly",
  "calstatela", "carleton", "catholic", "centre", "chapman", "chico", "cincinnati", "clark", "clarkson", "clemson", "cmc", "cmu", "cofc",
  "colby", "colgate", "colorado", "coloradocollege", "colostate", "conncoll", "cpp", "creighton", "csub", "csuci", "csudh", "csueb",
  "csulb", "csumb", "csun", "csusb", "csusm", "davidson", "dayton", "denison", "depaul", "depauw", "dickinson", "drexel", "du", "duquesne",
  "ecu", "erau", "esf", "famu", "fandm", "fau", "fit", "fiu", "fordham", "fresno", "fsu", "fullerton", "furman", "gatech", "gettysburg",
  "gmu", "gonzaga", "grinnell", "gsu", "hamilton", "haverford", "hawaii", "hillsdale", "hmc", "hofstra", "holycross", "howard", "humboldt",
  "iastate", "iit", "illinoisstate", "jhu", "jmu", "kennesaw", "kent", "kenyon", "kstate", "ku", "lafayette", "lawrence", "lehigh",
  "lipscomb", "lmu", "louisville", "loyola", "lsu", "macalester", "marquette", "memphis", "mercer", "miami", "miamioh", "middlebury",
  "mines", "missouri", "montanastate", "montclair", "msstate", "mst", "msu", "mtholyoke", "mtsu", "mtu", "muhlenberg", "nau", "ncsu",
  "ndsu", "newschool", "niu", "njit", "nmsu", "nova", "nyu", "oberlin", "odu", "ohio", "okstate", "olemiss", "oregonstate", "ou", "oxy",
  "pace", "pacific", "pdx", "pepperdine", "pitzer", "pomona", "quinnipiac", "reed", "rhodes", "richmond", "rit", "rochester", "rowan",
  "rpi", "sacstate", "samford", "sandiego", "scripps", "scu", "sdstate", "sdsu", "seattleu", "setonhall", "sewanee", "sfsu", "simmons",
  "sjsu", "skidmore", "slu", "smith", "smu", "soka", "sonoma", "southcarolina", "southdakota", "spelman", "stanislaus", "stevens",
  "stjohns", "stolaf", "stthomas", "suffolk", "swarthmore", "syracuse", "tamu", "tcu", "temple", "tntech", "toledo", "towson", "trincoll",
  "trinitytx", "ttu", "tufts", "tulane", "tulsa", "txstate", "uab", "uaf", "uah", "uark", "ucdavis", "ucdenver", "ucf", "uci", "ucmerced",
  "uconn", "ucr", "ucsb", "ucsc", "ucsd", "udel", "uf", "uh", "uic", "uidaho", "uiowa", "uky", "umaine", "umass", "umassboston", "umassd",
  "umasslowell", "umbc", "umkc", "umn", "umt", "uncc", "uncg", "und", "unf", "unh", "union", "unl", "unlv", "unm", "unr", "unt", "uoregon",
  "uri", "usafa", "usf", "usfca", "usm", "usna", "usu", "uta", "utah", "utaustin", "utd", "utep", "utk", "utsa", "uvm", "uwm", "uwyo",
  "vassar", "vcu", "villanova", "vmi", "vt", "wabash", "wayne", "wellesley", "wesleyan", "westpoint", "wfu", "wheatonma", "whitman",
  "wichita", "williams", "wlu", "wm", "wmich", "wooster", "wpi", "wsu", "wustl", "wvu", "yu",
];

/**
 * Each school's logo in web/public/logos, from the school's own site icon or site logo where it was sharp
 * enough, otherwise the school's mark on Wikimedia Commons or in its Wikipedia infobox. Logos are the schools' trademarks, shown only to identify them.
 */
const LOGO_FILES: Record<string, string> = {
  ...Object.fromEntries([...CHECKED.map((c) => c.id), ...FAMOUS, ...MORE_LOGOS].map((id) => [id, `${id}.png`])),
  emory: "emory.svg",
  berkeley: "berkeley.svg",
};

/** The best-known schools, shown on the landing page. */
export const FEATURED: College[] = FAMOUS.map((id) => COLLEGES.find((c) => c.id === id)!);

export function logoUrl(id: string): string | undefined {
  const file = LOGO_FILES[id];
  return file ? `/logos/${file}` : undefined;
}

const BY_ID = new Map(COLLEGES.map((c) => [c.id, c]));

export function collegeById(id: string): College | undefined {
  return BY_ID.get(id);
}

/**
 * Last cycle's decision date for a round, moved to the current cycle: an application cycle runs from
 * August to July, so August to December dates fall in the first year and January to July in the next.
 */
export function expectedDecision(college: College | undefined, round: string, today = new Date()): string {
  const md = college?.decisions?.[round as keyof NonNullable<College["decisions"]>];
  if (!md) return "";
  const cycleStart = today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1;
  const month = Number(md.slice(0, 2));
  return `${month >= 8 ? cycleStart : cycleStart + 1}-${md}`;
}

/** Portal links the catalog used to give that turned out to be wrong (both were graduate portals). */
const RETIRED_PORTALS: Record<string, string[]> = {
  gatech: ["https://gradapp.gatech.edu/apply/status"],
  ucf: ["https://applynow.graduate.ucf.edu/apply/status"],
  umd: ["https://apply.umd.edu/apply/status"],
};

/** The catalog's current portal link for a school still saved with a retired one, otherwise null. */
export function replacementPortal(collegeId: string | null, portalUrl: string): string | null {
  if (!collegeId || !RETIRED_PORTALS[collegeId]?.includes(portalUrl)) return null;
  return BY_ID.get(collegeId)?.loginUrl ?? null;
}
