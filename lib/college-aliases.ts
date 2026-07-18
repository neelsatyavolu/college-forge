// Short-name / abbreviation → canonical Scorecard-searchable name.
// Used to expand acronyms the user types (UVA, UGA, BU, MIT) into the
// official name string that Scorecard's `school.name` filter matches.
// Ambiguous abbreviations are resolved to the most commonly intended school.

const RAW: Record<string, string> = {
  // Ivy + Stanford-tier
  harvard: "Harvard University",
  yale: "Yale University",
  princeton: "Princeton University",
  brown: "Brown University",
  columbia: "Columbia University",
  cornell: "Cornell University",
  dartmouth: "Dartmouth College",
  upenn: "University of Pennsylvania",
  penn: "University of Pennsylvania",
  stanford: "Stanford University",
  mit: "Massachusetts Institute of Technology",
  caltech: "California Institute of Technology",
  uchicago: "University of Chicago",

  // T20 / elite privates
  duke: "Duke University",
  jhu: "Johns Hopkins University",
  "johns hopkins": "Johns Hopkins University",
  northwestern: "Northwestern University",
  vandy: "Vanderbilt University",
  vanderbilt: "Vanderbilt University",
  rice: "Rice University",
  emory: "Emory University",
  cmu: "Carnegie Mellon University",
  "carnegie mellon": "Carnegie Mellon University",
  washu: "Washington University in St Louis",
  "wash u": "Washington University in St Louis",
  notre_dame: "University of Notre Dame",
  "notre dame": "University of Notre Dame",
  tufts: "Tufts University",
  georgetown: "Georgetown University",

  // California publics
  ucla: "University of California-Los Angeles",
  ucb: "University of California-Berkeley",
  berkeley: "University of California-Berkeley",
  "cal berkeley": "University of California-Berkeley",
  ucsd: "University of California-San Diego",
  ucsb: "University of California-Santa Barbara",
  ucsc: "University of California-Santa Cruz",
  uci: "University of California-Irvine",
  ucd: "University of California-Davis",
  "uc davis": "University of California-Davis",
  ucr: "University of California-Riverside",
  ucm: "University of California-Merced",
  usc: "University of Southern California",

  // East coast big publics
  uva: "University of Virginia",
  vt: "Virginia Tech",
  vtech: "Virginia Tech",
  "virginia tech": "Virginia Polytechnic Institute and State University",
  unc: "University of North Carolina at Chapel Hill",
  "unc chapel hill": "University of North Carolina at Chapel Hill",
  ncsu: "North Carolina State University",
  "nc state": "North Carolina State University",
  uga: "University of Georgia",
  gatech: "Georgia Institute of Technology",
  "georgia tech": "Georgia Institute of Technology",
  uf: "University of Florida",
  fsu: "Florida State University",
  umd: "University of Maryland-College Park",
  "u maryland": "University of Maryland-College Park",
  wm: "William & Mary",
  "w&m": "William & Mary",
  "william and mary": "William & Mary",
  "william & mary": "William & Mary",

  // Midwest publics
  umich: "University of Michigan-Ann Arbor",
  "u michigan": "University of Michigan-Ann Arbor",
  msu: "Michigan State University",
  "michigan state": "Michigan State University",
  osu: "Ohio State University-Main Campus",
  "ohio state": "Ohio State University-Main Campus",
  iu: "Indiana University-Bloomington",
  indiana: "Indiana University-Bloomington",
  psu: "Pennsylvania State University-Main Campus",
  "penn state": "Pennsylvania State University-Main Campus",
  pitt: "University of Pittsburgh-Pittsburgh Campus",
  uiuc: "University of Illinois Urbana-Champaign",
  illinois: "University of Illinois Urbana-Champaign",
  purdue: "Purdue University-Main Campus",
  uwisc: "University of Wisconsin-Madison",
  "wisconsin madison": "University of Wisconsin-Madison",
  "uw madison": "University of Wisconsin-Madison",
  umn: "University of Minnesota-Twin Cities",
  "u minnesota": "University of Minnesota-Twin Cities",

  // Northeast privates / publics
  bu: "Boston University",
  bc: "Boston College",
  nyu: "New York University",
  fordham: "Fordham University",
  northeastern: "Northeastern University",
  rpi: "Rensselaer Polytechnic Institute",
  rit: "Rochester Institute of Technology",
  rochester: "University of Rochester",
  rutgers: "Rutgers University-New Brunswick",
  lehigh: "Lehigh University",
  villanova: "Villanova University",
  uconn: "University of Connecticut",
  umass: "University of Massachusetts-Amherst",
  "umass amherst": "University of Massachusetts-Amherst",
  gwu: "George Washington University",
  "george washington": "George Washington University",
  "case western": "Case Western Reserve University",
  cwru: "Case Western Reserve University",
  syracuse: "Syracuse University",

  // South/Southwest
  ut: "University of Texas at Austin",
  "ut austin": "University of Texas at Austin",
  utexas: "University of Texas at Austin",
  "texas am": "Texas A&M University",
  "texas a&m": "Texas A&M University",
  tamu: "Texas A&M University",
  "miami fl": "University of Miami",
  asu: "Arizona State University",
  "arizona state": "Arizona State University-Tempe",
  ua: "University of Arizona",
  tulane: "Tulane University",
  "wake forest": "Wake Forest University",

  // West / Pac NW
  uw: "University of Washington-Seattle Campus",
  "u washington": "University of Washington-Seattle Campus",
  uo: "University of Oregon",
  "u oregon": "University of Oregon",
  cu: "University of Colorado Boulder",
  "cu boulder": "University of Colorado Boulder",
};

const TABLE: Record<string, string> = {};
for (const [k, v] of Object.entries(RAW)) {
  TABLE[k.toLowerCase().trim().replace(/\s+/g, " ")] = v;
}

/**
 * If the query (case-insensitive, whitespace-normalized) matches an alias,
 * return the canonical name to also query Scorecard with. Otherwise null.
 */
export function expandAlias(query: string): string | null {
  const key = query.toLowerCase().trim().replace(/\s+/g, " ");
  if (key.length === 0) return null;
  return TABLE[key] ?? null;
}
