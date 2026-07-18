// Probes the shape of per-program earnings/debt so we wire real field paths.
const KEY = process.env.COLLEGE_SCORECARD_API_KEY;
const url = new URL("https://api.data.gov/ed/collegescorecard/v1/schools.json");
url.searchParams.set("api_key", KEY);
url.searchParams.set("school.name", "Stanford University");
url.searchParams.set("fields", "id,school.name,latest.programs.cip_4_digit");
url.searchParams.set("per_page", "1");

const j = await (await fetch(url)).json();
const progs = j.results?.[0]?.["latest.programs.cip_4_digit"] ?? [];
const cs = progs.find((p) => p.code === "1107" && p.credential?.level === 3) || progs[0];

console.log("program:", cs.code, cs.title, "|", cs.credential?.title);
console.log("counts:", JSON.stringify(cs.counts));
console.log("\nearnings tree:");
const walk = (o, path = "", depth = 0) => {
  if (depth > 3 || o == null) return;
  for (const [k, v] of Object.entries(o)) {
    if (v !== null && typeof v === "object") walk(v, `${path}.${k}`, depth + 1);
    else if (v !== null) console.log(`  ${path}.${k} = ${v}`);
  }
};
walk(cs.earnings, "earnings");
console.log("\ndebt tree:");
walk(cs.debt, "debt");

// How many bachelor's programs actually carry earnings?
const bach = progs.filter((p) => p.credential?.level === 3);
const withEarnings = bach.filter((p) => JSON.stringify(p.earnings ?? {}).match(/:\s*\d/));
console.log(`\nbachelor's: ${bach.length}, with any earnings data: ${withEarnings.length}`);
