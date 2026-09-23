import { NextRequest } from "next/server";
import { expandAlias } from "@/lib/college-aliases";
import {
  scorecardToCollege,
  fitFor,
  usNewsToCollege,
  withUsNews,
  type ScorecardCollege,
} from "@/lib/colleges";
import { US_NEWS_TOP_250 } from "@/lib/us-news-rankings";
import { getWorkspace } from "@/lib/store";
import { getWorkspaceId } from "@/lib/workspace-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Searches College Scorecard (data.gov) across every operating US college that
// predominantly awards bachelor's (3) or graduate (4) degrees — most R1s are 4
// because grad enrollment exceeds undergrad, but they still award bachelor's.
const FIELDS = [
  "id",
  "school.name",
  "school.alias",
  "school.city",
  "school.state",
  "school.school_url",
  "school.ownership",
  "school.locale",
  "latest.student.size",
  "latest.admissions.admission_rate.overall",
  "latest.admissions.sat_scores.25th_percentile.critical_reading",
  "latest.admissions.sat_scores.25th_percentile.math",
  "latest.admissions.sat_scores.75th_percentile.critical_reading",
  "latest.admissions.sat_scores.75th_percentile.math",
  "latest.admissions.act_scores.25th_percentile.cumulative",
  "latest.admissions.act_scores.75th_percentile.cumulative",
  "latest.cost.tuition.in_state",
  "latest.cost.tuition.out_of_state",
  "latest.cost.avg_net_price.overall",
  "latest.completion.completion_rate_4yr_150nt",
  "latest.earnings.10_yrs_after_entry.median",
].join(",");

type Hit = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
function sum2(a: unknown, b: unknown): number | null {
  return typeof a === "number" && typeof b === "number" ? a + b : null;
}

async function fetchScorecard(term: string, apiKey: string): Promise<Hit[]> {
  const url = new URL("https://api.data.gov/ed/collegescorecard/v1/schools.json");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("school.name", term);
  url.searchParams.set("school.operating", "1");
  url.searchParams.set("school.degrees_awarded.predominant__range", "3..4");
  url.searchParams.set("fields", FIELDS);
  url.searchParams.set("per_page", "25");
  url.searchParams.set("sort", "latest.student.size:desc");
  const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Scorecard ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { results?: Hit[] };
  return body.results ?? [];
}

// Exact > prefix > substring > all-tokens-present, with official alias matches
// weighted heavily ("BU", "UCLA") and enrollment as a small tiebreaker.
function rankByRelevance(rows: Hit[], qRaw: string, expanded: string | null): Hit[] {
  const q = qRaw.trim().toLowerCase();
  const e = expanded ? expanded.trim().toLowerCase() : null;
  const qTokens = q.split(/\s+/).filter(Boolean);
  const eTokens = e ? e.split(/\s+/).filter(Boolean) : [];

  const matchScore = (name: string, term: string, tokens: string[]): number => {
    if (!term) return 0;
    let s = 0;
    if (name === term) s += 1000;
    if (name.startsWith(term + " ") || name.startsWith(term + "-")) s += 500;
    if (name.startsWith(term)) s += 300;
    if (term.length >= 3 && name.includes(term)) s += 200;
    if (tokens.length > 0 && tokens.every((t) => name.includes(t))) s += 100;
    return s;
  };

  const score = (r: Hit): number => {
    const name = str(r["school.name"]).toLowerCase();
    const aliasField = str(r["school.alias"]).toLowerCase();
    let s = matchScore(name, q, qTokens);
    if (e) s = Math.max(s, matchScore(name, e, eTokens));
    if (q.length >= 2 && aliasField) {
      const aliases = aliasField.split(/[|;,]/).map((a) => a.trim());
      if (aliases.some((a) => a === q)) s += 600;
      else if (aliases.some((a) => a.startsWith(q))) s += 200;
    }
    const sz = num(r["latest.student.size"]) ?? 0;
    if (sz > 0) s += Math.min(50, Math.log10(sz + 1) * 10);
    return s;
  };

  return [...rows].sort((a, b) => score(b) - score(a));
}

function toScorecardCollege(r: Hit): ScorecardCollege {
  return {
    id: num(r.id) ?? 0,
    name: str(r["school.name"]),
    alias: str(r["school.alias"]) || null,
    city: str(r["school.city"]),
    state: str(r["school.state"]),
    url: str(r["school.school_url"]) || null,
    ownership: num(r["school.ownership"]),
    locale: num(r["school.locale"]),
    size: num(r["latest.student.size"]),
    admitRate: num(r["latest.admissions.admission_rate.overall"]),
    sat25: sum2(
      r["latest.admissions.sat_scores.25th_percentile.critical_reading"],
      r["latest.admissions.sat_scores.25th_percentile.math"]
    ),
    sat75: sum2(
      r["latest.admissions.sat_scores.75th_percentile.critical_reading"],
      r["latest.admissions.sat_scores.75th_percentile.math"]
    ),
    act25: num(r["latest.admissions.act_scores.25th_percentile.cumulative"]),
    act75: num(r["latest.admissions.act_scores.75th_percentile.cumulative"]),
    netPrice: num(r["latest.cost.avg_net_price.overall"]),
    tuitionIn: num(r["latest.cost.tuition.in_state"]),
    tuitionOut: num(r["latest.cost.tuition.out_of_state"]),
    completion4yr: num(r["latest.completion.completion_rate_4yr_150nt"]),
    earnings10yr: num(r["latest.earnings.10_yrs_after_entry.median"]),
  };
}

function json(body: unknown, status = 200, setCookie?: string): Response {
  // Built with new Response(): Response.json(data, init) drops headers here.
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  if (setCookie) headers["set-cookie"] = setCookie;
  return new Response(JSON.stringify(body), { status, headers });
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const browse = req.nextUrl.searchParams.get("browse") === "1" || q.length === 0;
  const { id, setCookie } = getWorkspaceId(req);

  // Default browse: US News National Universities top ~250 (photos + ranks).
  // Search (q ≥ 2) still hits the live College Scorecard for every school.
  if (browse && q.length < 2) {
    try {
      const ws = await getWorkspace(id);
      const applicantSat = ws.profile.testing.sat || ws.applicant.sat;
      const onList = new Set(ws.colleges.map((c) => c.slug));
      const data = US_NEWS_TOP_250.map((u) => {
        const college = usNewsToCollege(u);
        const { tags, tier } = fitFor(college, applicantSat, `${ws.applicant.satNote} ${ws.profile.testing.satNote}`);
        return {
          ...college,
          scorecardId: u.scorecardId,
          tags,
          tier,
          onList: onList.has(college.slug),
        };
      });
      return json({ success: true, data, source: "us-news-top-250" }, 200, setCookie);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Browse failed.";
      return json({ success: false, error: message }, 502, setCookie);
    }
  }

  if (q.length < 2) return json({ success: true, data: [] }, 200, setCookie);

  const key = process.env.COLLEGE_SCORECARD_API_KEY;
  if (!key) {
    return json(
      { success: false, error: "College search is unavailable: COLLEGE_SCORECARD_API_KEY is not configured." },
      503,
      setCookie
    );
  }

  const expanded = expandAlias(q);
  const terms = expanded ? [q, expanded] : [q];

  try {
    const responses = await Promise.all(terms.map((t) => fetchScorecard(t, key)));
    const merged = new Map<number, Hit>();
    for (const rows of responses) {
      for (const r of rows) {
        const rid = num(r.id);
        if (rid !== null && !merged.has(rid)) merged.set(rid, r);
      }
    }

    // Tag each result against the applicant's SAT so the list shows real fit.
    const ws = await getWorkspace(id);
    const applicantSat = ws.profile.testing.sat || ws.applicant.sat;
    const onList = new Set(ws.colleges.map((c) => c.slug));

    const data = rankByRelevance([...merged.values()], q, expanded)
      .slice(0, 25)
      .map((r) => {
        const sc = toScorecardCollege(r);
        // scorecardToCollege already attaches US News rank + photo when known.
        const college = withUsNews(scorecardToCollege(sc), sc.id);
        const { tags, tier } = fitFor(college, applicantSat, `${ws.applicant.satNote} ${ws.profile.testing.satNote}`);
        // scorecardId lets the detail panel fetch the heavy per-school record.
        return { ...college, scorecardId: sc.id, tags, tier, onList: onList.has(college.slug) };
      });

    console.log(`[colleges] q="${q}"${expanded ? ` (expanded="${expanded}")` : ""} -> ${data.length} results`);
    return json({ success: true, data, source: "scorecard" }, 200, setCookie);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed.";
    console.error(`[colleges] search failed for q="${q}":`, err);
    return json({ success: false, error: message }, 502, setCookie);
  }
}
