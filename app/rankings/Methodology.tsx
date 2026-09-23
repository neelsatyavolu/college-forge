import { useJson } from "./hooks";
import type { Cohorts, SensitivityRow, Weights } from "./types";

const COMPONENTS: { key: keyof Weights; title: string; body: string }[] = [
  {
    key: "early_premium",
    title: "Early-career earnings",
    body: "Median earnings 1 to 5 years after graduating, compared with people who studied the same major elsewhere, then adjusted for living costs where graduates work. A college isn’t rewarded just for offering high-paying majors.",
  },
  {
    key: "long_premium",
    title: "Later earnings",
    body: "Median earnings about six years after graduating (ten years after starting college), compared with what the college’s mix of majors predicts. It includes students who didn’t finish, so it partly overlaps graduation.",
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
  equal_weights: "Equal weights (25% each)",
  earnings_only: "Earnings only",
  early_earnings_only: "Early earnings only",
  no_graduation: "Without graduation",
  no_employment: "Without employment",
  no_cost_of_living: "Without cost-of-living adjustment",
};

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
        Department of Education records. It has not been tested as a prediction of any future student’s career, and it
        doesn’t measure what a college causes. The weights were set before we looked at the results and weren’t adjusted to
        make the list look familiar.
      </p>

      <div className="rk-weights">
        {COMPONENTS.map((c) => (
          <article key={c.key} className="rk-weight">
            <span className="rk-weight__pct">{Math.round(weights[c.key] * 100)}%</span>
            <h3>{c.title}</h3>
            <p>{c.body}</p>
          </article>
        ))}
      </div>
      <p className="rk-method__note">
        The score is a relative index: the top college is 100 and the lowest is 0. It isn’t a probability or a percentage of
        anything. Major tables use only that major’s earnings, not graduation or employment.
      </p>

      <div className="rk-method__cols">
        <div>
          <h3>What’s left out on purpose</h3>
          <ul>
            <li><strong>Selectivity and prestige get no direct weight.</strong> Admit rates, test scores, reputation, research and spending describe who gets in, not how graduates do. (Admissions data does help estimate where graduates live when that isn’t observed, and it drives the separate “Beats expectations” view.)</li>
            <li><strong>Price.</strong> Net price is shown for context but never scored.</li>
            <li><strong>Job quality, fit and upside.</strong> Medians say nothing about hours, benefits, satisfaction, or the chance of an exceptional career.</li>
          </ul>
        </div>
        <div>
          <h3>How to read a rank</h3>
          <ul>
            <li><strong>Ranges show uncertainty within this model.</strong> The small numbers under each rank cover earnings noise and, where graduate location is estimated, its error. They don’t cover other reasonable choices, like the weights or the cost-of-living basket. Overlapping ranges mean you shouldn’t read much into the exact order. They don’t prove two colleges are equal.</li>
            <li><strong>Cost of living changes some ranks a lot.</strong> Use the toggle to see both orderings. Access to expensive job markets can itself be a career advantage.</li>
            <li><strong>Small programs are pulled toward the middle.</strong> Overall, a college’s programs are pooled. In major tables, each program stands on its own graduates and never borrows the college’s results in other majors.</li>
            <li><strong>“Beats expectations”</strong> compares a college with what a model predicts from its incoming students. It highlights colleges worth a closer look; it doesn’t prove the college caused the difference.</li>
          </ul>
        </div>
      </div>

      {sens.data && (
        <div className="rk-sens">
          <h3>How much the list moves under other reasonable choices</h3>
          <table>
            <thead>
              <tr><th>Alternative</th><th>Similarity to this list</th><th>Same top 25</th></tr>
            </thead>
            <tbody>
              {sens.data.map((r) => (
                <tr key={r.variant}>
                  <td>{VARIANTS[r.variant] ?? r.variant}</td>
                  <td>{r.spearman_vs_headline.toFixed(2)}</td>
                  <td>{r.top25_overlap} of 25</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>Similarity is a rank correlation (1.00 = identical order). A high overall number can still hide big moves for individual colleges.</p>
        </div>
      )}

      <details className="rk-details">
        <summary>Data sources, dates and limitations</summary>
        <ul>
          <li>Earnings: {cohorts["4yr"]} (4 years out); {cohorts["5yr"]} (5 years out); {cohorts["1yr"]} (1 year out); {cohorts["10yr_entry"]} (later earnings). All shown in 2024 dollars. “Updated” on this page is when the ranking was rebuilt, not when graduates were measured.</li>
          <li>Earnings are annual wages and self-employment income, not base salary. They cover students who got federal grants or loans, which can be a minority at wealthy colleges; international students aren’t included.</li>
          <li>Cost of living uses federal regional price data weighted toward housing. Where graduates work is observed in Census data for about a quarter of colleges and estimated for the rest (including most top-ranked ones). State taxes aren’t deducted.</li>
          <li>Majors follow federal CIP codes, which may not match catalog names and can group specialties (nurse anesthesia sits inside nursing).</li>
          <li>Not yet validated: we haven’t tested whether earlier data predicts later graduates’ outcomes, or checked estimated graduate locations against better data. Those tests are next.</li>
          <li>For-profit colleges, online-only colleges and colleges in U.S. territories aren’t ranked. The overall table needs a first-time-student graduation rate, so graduate-only and upper-division schools appear only in major tables.</li>
        </ul>
        <p>
          Sources and coverage: <a href="/data/rankings/sources.md">sources.md</a>. The full method, code and tests live in the
          repository under <code>ranking/</code>.
        </p>
      </details>
    </section>
  );
}
