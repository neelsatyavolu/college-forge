import { useJson } from "./hooks";
import type { Cohorts, SensitivityRow, ValidationFile, Weights } from "./types";

const COMPONENTS: { key: keyof Weights; title: string; body: string }[] = [
  {
    key: "early_premium",
    title: "Early-career earnings",
    body: "Median earnings four years after graduating (five where the four-year figure is withheld), compared with people who studied the same major at other colleges. A college isn’t rewarded just for offering high-paying majors.",
  },
  {
    key: "graduation",
    title: "Graduation",
    body: "The share of first-time, full-time students who finish within six years. A degree only pays off if you complete it.",
  },
  {
    key: "employment",
    title: "Employment",
    body: "The share of graduates working three years after finishing, among those not back in school. Working isn’t the same as a good job; job quality isn’t measured.",
  },
];

const VARIANTS: Record<string, string> = {
  equal_weights: "Equal weights",
  early_earnings_only: "Early earnings only",
  no_graduation: "Without graduation",
  no_employment: "Without employment",
  with_cost_of_living: "After cost of living",
  completion_weighted_programs: "Weight programs by graduates instead of pooling",
  coverage_at_least_50pct: "Require programs with earnings to cover 50% of graduates",
  coverage_at_least_70pct: "Require programs with earnings to cover 70% of graduates",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;
const err = (n: number) => `${(n * 100).toFixed(1)}%`;

function Validation() {
  const { data } = useJson<ValidationFile>("/data/rankings/validation.json");
  if (!data) return null;
  const rows = (["bachelors", "masters"] as const).map((c) => ({ c, v: data.chosen[c] }));
  return (
    <div className="rk-sens">
      <h3>Does it predict the next graduating class?</h3>
      <p className="rk-method__note rk-method__note--flush">
        We rebuilt every program’s estimate using only students who graduated in 2014–16, then compared it with what the
        2017–19 graduates actually earned. Settings were chosen on 80% of colleges and scored on the other 20%. An
        outside review caught flaws in our first version of this test, and these are the corrected results. Because we
        had seen the earlier results, treat this as a careful look back rather than a pristine test.
      </p>
      <table>
        <thead>
          <tr><th /><th>Typical miss (this method)</th><th>Previous method</th><th>Last class’s raw earnings</th><th>Order agreement (this / raw)</th><th>90% prediction intervals that held</th></tr>
        </thead>
        <tbody>
          {rows.map(({ c, v }) => (
            <tr key={c}>
              <td>{c === "bachelors" ? "Bachelor’s" : "Master’s"}</td>
              <td>{err(v.test.within_major_rmse)}</td>
              <td>{err(v.test_major_only_sd070.within_major_rmse)}</td>
              <td>{err(v.test_raw_baseline.within_major_rmse)}</td>
              <td>{v.test.rho.toFixed(2)} / {v.test_raw_baseline.rho.toFixed(2)}</td>
              <td>{pct(v.coverage_90.with_floor.all)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Misses are within-major earnings errors (log points, ≈ percent). Order agreement is the rank correlation with the
        next class within each major. For master’s programs the ordering is on par with simpler methods, not better. This
        checks program earnings estimates, not the overall weights or rank ranges. One pair of graduating classes can’t
        show the method holds in every economy; the next federal data release is the next test.
      </p>
    </div>
  );
}

export default function Methodology({ weights, cohorts }: { weights: Weights; cohorts: Cohorts }) {
  const sens = useJson<SensitivityRow[]>("/data/rankings/sensitivity.json");
  return (
    <section className="rk-method" id="methodology" aria-labelledby="method-title">
      <div className="cf-section-heading">
        <h2 id="method-title">How the ranking works</h2>
        <a href="/data/rankings/DISCLOSURE.md">Full disclosures ↗</a>
      </div>
      <p className="rk-method__lede">
        This ranking compares <strong>what happened to past graduates</strong> who received federal financial aid, using U.S.
        Department of Education records. Where the data can decide a modeling choice, we chose whatever best predicted a
        later graduating class. The weights below are value judgments, set before we looked at the results. It doesn’t
        measure what a college causes, and it isn’t a forecast for any one student.
      </p>

      <div className="rk-weights rk-weights--three">
        {COMPONENTS.map((c) => (
          <article key={c.key} className="rk-weight">
            <span className="rk-weight__pct">{Math.round(weights[c.key] * 100)}%</span>
            <h3>{c.title}</h3>
            <p>{c.body}</p>
          </article>
        ))}
      </div>
      <p className="rk-method__note">
        The score is a relative index: the top college is 100 and the lowest is 0. Later earnings (about six years after
        graduating) are shown for each college but not scored, because that figure mixes graduates with students who didn’t
        finish. Major tables rank only that major’s earnings.
      </p>

      <div className="rk-method__cols">
        <div>
          <h3>What’s left out on purpose</h3>
          <ul>
            <li><strong>Selectivity and prestige get no direct weight.</strong> Admit rates, test scores, reputation, research and spending describe who gets in, not how graduates do. (Admissions data does help estimate where graduates live for the cost-of-living view, and it drives “Beats expectations.”)</li>
            <li><strong>Cost of living is an estimate.</strong> Rankings are shown after cost of living by default, but where graduates work is estimated for about three-quarters of colleges and hasn’t been checked against better data yet. Switch to “As reported” to rank on earnings alone, with no location data. That’s the version our backtest checks. Access to expensive, high-paying job markets can itself be a career advantage.</li>
            <li><strong>Price, job quality and fit.</strong> Net price is shown but never scored; medians say nothing about hours, satisfaction or the chance of an exceptional career.</li>
          </ul>
        </div>
        <div>
          <h3>How to read a rank</h3>
          <ul>
            <li><strong>Ranges show uncertainty within the model.</strong> The small numbers under each rank cover noise in the earnings data (and, in the cost-of-living view, estimated locations). They describe how uncertain each estimate is, not how much a future class could differ, and they aren’t separately calibrated. Wider prediction intervals, which add a future class’s own randomness, held the next class’s result 91–94% of the time in our backtest. Ranges don’t cover choices like the weights (see the table below).</li>
            <li><strong>Small programs lean on their college.</strong> A program with few graduates is pulled toward its college’s results in other majors, in proportion to how noisy its own data are. We tested this against judging each program alone, and it predicted the next class better. What’s borrowed is measured outcomes, not reputation.</li>
            <li><strong>“Beats expectations”</strong> compares a college with what a model predicts from its incoming students. It highlights colleges worth a closer look; it doesn’t prove the college caused the difference.</li>
          </ul>
        </div>
      </div>

      <Validation />

      {sens.data && (
        <div className="rk-sens">
          <h3>How much the list moves under other reasonable choices</h3>
          <table>
            <thead>
              <tr><th>Alternative</th><th>Similarity</th><th>Same top 25</th><th>Typical college moves</th></tr>
            </thead>
            <tbody>
              {sens.data.map((r) => (
                <tr key={r.variant}>
                  <td>{VARIANTS[r.variant] ?? r.variant}{r.variant.startsWith("coverage") ? ` (${r.n_schools.toLocaleString()} colleges)` : ""}</td>
                  <td>{r.spearman_vs_headline.toFixed(2)}</td>
                  <td>{r.top25_overlap} of 25</td>
                  <td>{Math.round(r.median_rank_shift)} {Math.round(r.median_rank_shift) === 1 ? "place" : "places"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Similarity is a rank correlation (1.00 = identical order) with the as-reported ordering, among the colleges in both lists. The coverage rows
            only show that dropping colleges with thinner data barely reorders the rest.
          </p>
        </div>
      )}

      <details className="rk-details">
        <summary>Data sources, dates and limitations</summary>
        <ul>
          <li>Earnings: {cohorts["4yr"]} (4 years out); {cohorts["5yr"]} (5 years out); {cohorts["1yr"]} (1 year out); {cohorts["10yr_entry"]} (later earnings). All shown in 2024 dollars. “Rebuilt” on this page is when the ranking was recomputed, not when graduates were measured.</li>
          <li>Earnings are annual wages and self-employment income, not base salary. They cover students who got federal grants or loans, which can be a minority at wealthy colleges; international students aren’t included.</li>
          <li>Cost of living uses federal regional price data weighted toward housing. Where graduates work is observed in Census data for about a quarter of colleges and estimated for the rest. State taxes aren’t deducted.</li>
          <li>Majors follow federal CIP codes, which may not match catalog names and can group specialties (nurse anesthesia sits inside nursing).</li>
          <li>Still to validate: estimated graduate locations, and the “Beats expectations” model’s per-college uncertainty.</li>
          <li>For-profit colleges, online-only colleges and colleges in U.S. territories aren’t ranked. The overall table needs a first-time-student graduation rate, so graduate-only and upper-division schools appear only in major tables.</li>
        </ul>
        <p>
          Sources and coverage: <a href="/data/rankings/sources.md">sources.md</a>. The full method, backtest, code and tests
          live in the repository under <code>ranking/</code>.
        </p>
      </details>
    </section>
  );
}
