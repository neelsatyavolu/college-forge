import type { Weights } from "./types";

const COMPONENTS: { key: keyof Weights; title: string; body: string }[] = [
  {
    key: "early_premium",
    title: "Early-career earnings",
    body: "What graduates earn one to five years out, compared with people who studied the same major at other colleges, adjusted for living costs where they work. A college isn’t rewarded just for offering high-paying majors.",
  },
  {
    key: "long_premium",
    title: "Long-run earnings",
    body: "Median earnings ten years after starting college, compared with what the college’s mix of majors would predict. This picks up careers that start slow, such as graduate school or medicine.",
  },
  {
    key: "graduation",
    title: "Graduation",
    body: "The share of students who finish within six years. A degree only pays off if you complete it.",
  },
  {
    key: "employment",
    title: "Employment",
    body: "The share of graduates who are working three years after finishing, among those not back in school.",
  },
];

export default function Methodology({ weights }: { weights: Weights }) {
  return (
    <section className="rk-method" id="methodology" aria-labelledby="method-title">
      <div className="cf-section-heading">
        <h2 id="method-title">How the ranking works</h2>
        <a href="/data/rankings/DISCLOSURE.md">Full disclosures ↗</a>
      </div>
      <p className="rk-method__lede">
        The question is simple: <strong>if you go here, how do graduates like you do?</strong> Every college is scored on
        what happens after graduation, using U.S. Department of Education data. Weights were set before we looked at the
        results and were not adjusted to make the list look familiar.
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

      <div className="rk-method__cols">
        <div>
          <h3>What’s left out on purpose</h3>
          <ul>
            <li><strong>Selectivity and prestige.</strong> Admit rates, test scores, reputation surveys, research output and spending measure who gets in and how wealthy a college is, not what it does for students.</li>
            <li><strong>Price.</strong> Net price is shown for context but never scored.</li>
            <li><strong>Fit.</strong> Teaching quality, campus life and wellbeing matter, but no public data measures them fairly.</li>
          </ul>
        </div>
        <div>
          <h3>How to read a rank</h3>
          <ul>
            <li><strong>Ranges matter more than exact ranks.</strong> The small numbers under each rank show where a college lands 90% of the time given the uncertainty in its data. Colleges with overlapping ranges aren’t meaningfully different.</li>
            <li><strong>Small programs are handled carefully.</strong> Results from few graduates are pulled toward what the rest of the college’s data suggests, so one lucky class doesn’t top a list.</li>
            <li><strong>“Beats expectations”</strong> compares each college with what its incoming students would predict. It shows which colleges add the most, not which admit the most advantaged students.</li>
          </ul>
        </div>
      </div>

      <details className="rk-details">
        <summary>Data limitations</summary>
        <ul>
          <li>Federal earnings data covers students who received federal grants or loans. At wealthy colleges that’s a minority of students.</li>
          <li>Earnings describe graduates from several years ago and may not match today’s outcomes.</li>
          <li>Cost of living uses federal regional price data, weighted toward housing, priced where graduates actually work. State taxes aren’t deducted.</li>
          <li>Majors follow federal CIP codes, which can group related specialties (nurse anesthesia sits inside nursing, for example).</li>
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
