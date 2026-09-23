import { NextRequest } from "next/server";
import {
  scorecardToCollege,
  fitFor,
  cipArea,
  CREDENTIAL_LABEL,
  OWNERSHIP_LABEL,
  TEST_POLICY_LABEL,
  type ProgramRow,
  type ScorecardCollege,
} from "@/lib/colleges";
import { getWorkspace } from "@/lib/store";
import { getWorkspaceId } from "@/lib/workspace-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Full per-school detail. Kept separate from /search because the programs
// array is large (Stanford alone returns 186 entries) — we only pay for it
// on the school the user actually opened.
const FIELDS = [
  "id",
  "school.name",
  "school.alias",
  "school.city",
  "school.state",
  "school.school_url",
  "school.price_calculator_url",
  "school.ownership",
  "school.locale",
  "latest.student.size",
  "latest.student.retention_rate.four_year.full_time",
  "latest.admissions.admission_rate.overall",
  "latest.admissions.test_requirements",
  "latest.admissions.sat_scores.25th_percentile.critical_reading",
  "latest.admissions.sat_scores.25th_percentile.math",
  "latest.admissions.sat_scores.75th_percentile.critical_reading",
  "latest.admissions.sat_scores.75th_percentile.math",
  "latest.admissions.act_scores.25th_percentile.cumulative",
  "latest.admissions.act_scores.75th_percentile.cumulative",
  "latest.cost.attendance.academic_year",
  "latest.cost.tuition.in_state",
  "latest.cost.tuition.out_of_state",
  "latest.cost.avg_net_price.overall",
  "latest.completion.completion_rate_4yr_100nt",
  "latest.completion.completion_rate_4yr_150nt",
  "latest.earnings.10_yrs_after_entry.median",
  "latest.aid.pell_grant_rate",
  "latest.programs.cip_4_digit",
].join(",");

type Hit = Record<string, any>;

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const sum2 = (a: unknown, b: unknown): number | null =>
  typeof a === "number" && typeof b === "number" ? a + b : null;

const money = (n: number | null) => (typeof n === "number" ? `$${Math.round(n).toLocaleString()}` : undefined);
const pct = (n: number | null) => (typeof n === "number" ? `${Math.round(n * 100)}%` : undefined);

function json(body: unknown, status = 200, setCookie?: string): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  if (setCookie) headers["set-cookie"] = setCookie;
  return new Response(JSON.stringify(body), { status, headers });
}

/** Bachelor's-level programs, with this school's earnings vs the national median. */
function toPrograms(raw: unknown): ProgramRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: ProgramRow[] = [];
  for (const p of raw as Hit[]) {
    const level = num(p?.credential?.level);
    // Undergraduate applicants care about bachelor's programs.
    if (level !== 3) continue;
    const code = str(p?.code);
    const title = str(p?.title).replace(/\.$/, "");
    if (!code || !title) continue;
    const e4 = p?.earnings?.["4_yr"];
    rows.push({
      code,
      title,
      area: cipArea(code),
      credential: CREDENTIAL_LABEL[level] ?? "Bachelor's",
      awards: num(p?.counts?.ipeds_awards2) ?? num(p?.counts?.ipeds_awards1),
      earnings4: num(e4?.overall_median_earnings),
      national4: num(e4?.overall_median_earnings_national),
    });
  }
  // Most-awarded first so the list leads with what the school actually graduates.
  return rows.sort((a, b) => (b.awards ?? 0) - (a.awards ?? 0));
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

function normalizeUrl(u: string): string | undefined {
  const t = u.trim();
  if (!t) return undefined;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export async function GET(req: NextRequest) {
  const idParam = (req.nextUrl.searchParams.get("id") ?? "").trim();
  const { id: wsId, setCookie } = getWorkspaceId(req);

  if (!/^\d+$/.test(idParam)) {
    return json({ success: false, error: "A numeric Scorecard 'id' is required." }, 400, setCookie);
  }
  const key = process.env.COLLEGE_SCORECARD_API_KEY;
  if (!key) {
    return json({ success: false, error: "COLLEGE_SCORECARD_API_KEY is not configured." }, 503, setCookie);
  }

  const url = new URL("https://api.data.gov/ed/collegescorecard/v1/schools.json");
  url.searchParams.set("api_key", key);
  url.searchParams.set("id", idParam);
  url.searchParams.set("fields", FIELDS);
  url.searchParams.set("per_page", "1");

  try {
    const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Scorecard ${res.status}: ${text.slice(0, 200)}`);
    }
    const body = (await res.json()) as { results?: Hit[] };
    const r = body.results?.[0];
    if (!r) return json({ success: false, error: "College not found." }, 404, setCookie);

    const base = scorecardToCollege(toScorecardCollege(r));
    const ws = await getWorkspace(wsId);
    const { tags, tier } = fitFor(base, ws.profile.testing.sat || ws.applicant.sat, `${ws.applicant.satNote} ${ws.profile.testing.satNote}`);
    // Anything the copilot already researched for this school (deadlines,
    // admit-by-plan, transfer policy) wins — the federal dataset has none of it.
    const saved = ws.colleges.find((c) => c.slug === base.slug);

    const ownership = num(r["school.ownership"]);
    const testReq = num(r["latest.admissions.test_requirements"]);

    const scId = num(r.id) ?? undefined;
    const detail = {
      ...base,
      ...(saved ?? {}),
      // Keep US News rank + campus photo even if the saved workspace row is sparse.
      rank: saved?.rank ?? base.rank,
      photo: saved?.photo || base.photo || null,
      scorecardId: scId,
      tags: saved?.tags ?? tags,
      tier: saved?.tier ?? tier,
      coa: money(num(r["latest.cost.attendance.academic_year"])),
      tuitionIn: money(num(r["latest.cost.tuition.in_state"])),
      tuitionOut: money(num(r["latest.cost.tuition.out_of_state"])),
      grad4: pct(num(r["latest.completion.completion_rate_4yr_100nt"])),
      retention: pct(num(r["latest.student.retention_rate.four_year.full_time"])),
      pellRate: pct(num(r["latest.aid.pell_grant_rate"])),
      ownership: ownership !== null ? OWNERSHIP_LABEL[ownership] : undefined,
      testPolicy: testReq !== null ? TEST_POLICY_LABEL[testReq] : undefined,
      url: normalizeUrl(str(r["school.school_url"])),
      priceCalcUrl: normalizeUrl(str(r["school.price_calculator_url"])),
      onList: Boolean(saved),
      programs: toPrograms(r["latest.programs.cip_4_digit"]),
    };

    console.log(
      `[colleges] detail id=${idParam} "${detail.name}" programs=${detail.programs.length} onList=${detail.onList}`
    );
    return json({ success: true, data: detail }, 200, setCookie);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lookup failed.";
    console.error(`[colleges] detail failed for id=${idParam}:`, err);
    return json({ success: false, error: message }, 502, setCookie);
  }
}
