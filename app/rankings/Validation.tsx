import { useJson } from "./hooks";
import type { Credential, ValidationFile } from "./types";

const CREDS: { id: Credential; label: string }[] = [
  { id: "bachelors", label: "Bachelor’s" },
  { id: "masters", label: "Master’s" },
];

const pct = (n: number) => `${Math.round(n * 100)}%`;
const pts = (n: number | null | undefined) => (n == null ? "—" : (n * 100).toFixed(1));
/** A 90% interval for (this − alternative) as "lower by a–b points", or a plain range if it crosses zero. */
const lowerBy = ([lo, hi]: [number, number]) =>
  hi < 0
    ? `${(-hi * 100).toFixed(1)}–${(-lo * 100).toFixed(1)} points lower`
    : `not clearly lower (${(lo * 100).toFixed(1)} to ${(hi * 100).toFixed(1)} points)`;

function HeadlineTable({ data }: { data: ValidationFile }) {
  return (
    <div className="rk-tablewrap">
      <table>
        <thead>
          <tr>
            <th />
            <th>Typical miss</th>
            <th>Without centering</th>
            <th>Raw earnings (typical miss)</th>
            <th>Best simpler method (typical miss)</th>
            <th>Order agreement (this / raw)</th>
            <th>90% prediction intervals that held</th>
          </tr>
        </thead>
        <tbody>
          {CREDS.map(({ id, label }) => {
            const v = data.chosen[id];
            return (
              <tr key={id}>
                <td>{label}</td>
                <td>{pts(v.test.within_major_rmse)}</td>
                <td>{pts(v.test.rmse)}</td>
                <td>{pts(v.test_raw_baseline.within_major_rmse)}</td>
                <td>{pts(v.test_major_only_tuned.within_major_rmse)}</td>
                <td>{v.test.rho?.toFixed(2) ?? "—"} / {v.test_raw_baseline.rho?.toFixed(2) ?? "—"} <small>({v.test.n_rho_majors} majors)</small></td>
                <td>{pct(v.coverage_90.with_floor.all)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StrataTable({ data }: { data: ValidationFile }) {
  return (
    <div className="rk-tablewrap">
      <table>
        <thead>
          <tr><th>Held-out programs</th><th>Programs</th><th>Typical miss (this / raw)</th><th>Without centering (this / raw)</th></tr>
        </thead>
        <tbody>
          {CREDS.map(({ id, label }) => {
            const v = data.chosen[id];
            const small = v.strata.target_under_50_earners;
            const smallRaw = v.strata_raw_baseline.target_under_50_earners;
            const five = v.strata.past_used_5yr_fallback;
            return [
              <tr key={`${id}-main`}>
                <td>{label}, 50+ graduates with earnings (headline)</td>
                <td>{v.test.n.toLocaleString()}</td>
                <td>{pts(v.test.within_major_rmse)} / {pts(v.test_raw_baseline.within_major_rmse)}</td>
                <td>{pts(v.test.rmse)} / {pts(v.test_raw_baseline.rmse)}</td>
              </tr>,
              small && smallRaw && (
                <tr key={`${id}-small`}>
                  <td>{label}, fewer than 50</td>
                  <td>{small.n.toLocaleString()}</td>
                  <td>{pts(small.within_major_rmse)} / {pts(smallRaw.within_major_rmse)}</td>
                  <td>{pts(small.rmse)} / {pts(smallRaw.rmse)}</td>
                </tr>
              ),
              five && (
                <tr key={`${id}-five`}>
                  <td>{label}, estimate built from 5-year earnings</td>
                  <td>{five.n.toLocaleString()}</td>
                  <td colSpan={2}>Too few to measure</td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

function smallBeatsRaw(data: ValidationFile): boolean {
  return CREDS.every(({ id }) => {
    const a = data.chosen[id].strata.target_under_50_earners?.within_major_rmse;
    const b = data.chosen[id].strata_raw_baseline.target_under_50_earners?.within_major_rmse;
    return a != null && b != null && a < b;
  });
}

function shiftHelpsSmall(data: ValidationFile): boolean {
  return CREDS.every(({ id }) => {
    const t = data.horizon_mapping.test[id];
    return t.major.rmse_small <= t.none.rmse_small;
  });
}

function stability(data: ValidationFile, id: Credential) {
  const runs = Object.values(data.repeated_splits).map((r) => r[id]);
  const same = runs.filter((r) => r.estimator === data.chosen[id].estimator && r.k === data.chosen[id].k).length;
  const beatError = runs.filter((r) => r.test_within_major_rmse < r.raw_within_major_rmse).length;
  const beatOrder = runs.filter((r) => r.test_rho > r.raw_rho).length;
  return { n: runs.length, same, beatError, beatOrder };
}

export default function Validation() {
  const { data } = useJson<ValidationFile>("/data/rankings/validation.json");
  if (!data) return null;
  const b = data.chosen.bachelors;
  const m = data.chosen.masters;
  const hb = data.horizon_mapping.test.bachelors;
  const hm = data.horizon_mapping.test.masters;
  const sb = stability(data, "bachelors");
  const sm = stability(data, "masters");
  return (
    <div className="rk-sens rk-sens--wide">
      <h3>Does it predict the next graduating class?</h3>
      <p className="rk-method__note rk-method__note--flush">
        We rebuilt every program’s estimate using only students who graduated in 2014–16, then compared it with what the
        2017–19 graduates actually earned. Settings were chosen on 80% of colleges and scored on the other 20%. This checks the
        program earnings estimates as reported, not the cost-of-living view, the overall weights or the rank ranges. We revised
        the method after seeing earlier results, so treat this as a careful look back rather than a pristine test.
      </p>
      <HeadlineTable data={data} />
      <p>
        Misses are earnings errors in log points (≈ percent). “Typical miss” removes each method’s average miss within a major,
        so it measures how accurately a method places programs relative to each other within a major; it can also hide a method’s major-wide bias, so the uncentered figure is shown
        too. The best simpler method judges each program against its major only, with its own best setting. Resampling colleges
        (90% intervals), this method’s typical miss is {lowerBy(b.test_minus_raw_within_major_rmse_90ci)} than raw earnings for
        bachelor’s and {lowerBy(m.test_minus_raw_within_major_rmse_90ci)} for master’s; against the best simpler method it is{" "}
        {lowerBy(b.test_minus_tuned_major_only_within_major_rmse_90ci)} and {lowerBy(m.test_minus_tuned_major_only_within_major_rmse_90ci)}. Order agreement is the rank correlation with the next class, averaged with equal weight
        over majors with at least 20 held-out programs ({b.test.n_rho_majors} bachelor’s, {m.test.n_rho_majors} master’s). For
        master’s programs the ordering is on par with raw earnings, not better. Held out: {b.test.n.toLocaleString()} bachelor’s
        programs at {b.test.n_institutions} colleges and {m.test.n.toLocaleString()} master’s programs at {m.test.n_institutions}.
      </p>
      <p>
        Rerunning everything on {sb.n} other random splits of colleges, the same settings won {sb.same} of {sb.n} times for bachelor’s and {sm.same} of{" "}
        {sm.n} for master’s. The typical miss beat raw earnings in {sb.beatError} of {sb.n} and {sm.beatError} of {sm.n}; order
        agreement beat raw earnings in {sb.beatOrder} of {sb.n} and {sm.beatOrder} of {sm.n}.
      </p>
      <StrataTable data={data} />
      <p>
        Most published programs are small, and misses there are larger
        {smallBeatsRaw(data) ? ", though still smaller than raw earnings’" : ""}; their 90% prediction intervals held{" "}
        {pct(b.coverage_90_target_under_50.with_floor.all)} and {pct(m.coverage_90_target_under_50.with_floor.all)} of the time. Too few
        held-out estimates came from 5-year earnings to measure them directly; the check below covers that step.
      </p>

      <h3 className="rk-sens__sub">Older 5-year earnings</h3>
      <p>
        About 9% of ranked programs withhold four-year earnings and are scored on five-year earnings of an older class.
        We shift those onto the four-year scale using each major’s average gap where colleges publish both. On held-out
        colleges, using a program’s shifted five-year figure to predict its four-year figure missed by {pts(hb.major.rmse)}{" "}
        points for bachelor’s (unshifted: {pts(hb.none.rmse)}) and {pts(hm.major.rmse)} for master’s (unshifted: {pts(hm.none.rmse)}),
        across {hb.n_programs.toLocaleString()} and {hm.n_programs.toLocaleString()} programs. {shiftHelpsSmall(data) ? "The shift also helped for programs with fewer than 30 graduates with earnings, and the" : "The"} 90% intervals held {pct(hb.major.coverage_90)} and{" "}
        {pct(hm.major.coverage_90)} of the time. Programs that publish both figures are larger than the ones that withhold
        four-year earnings, so this checks the shift where it can be seen, not in the withheld cases themselves.
      </p>
    </div>
  );
}
