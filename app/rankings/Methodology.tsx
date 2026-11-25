import { DEFAULT_WEIGHTS, PILLAR_LABELS, type Pillar } from "@/lib/career-ranking";

const WHAT: Record<Pillar, string> = {
  pay: "Median pay 1, 4, 5 and 7 years after graduating, from IRS records in the College Scorecard, in the major counted for each school. Each year is compared with the same year at the other schools. A year with few graduates measured is pulled toward what schools of similar selectivity show. A major with no published pay is estimated from the school's all-majors pay, and counts one typical estimating error lower.",
  wealth: "Top-quarter pay 10 years after starting, and the share of students from middle- and upper-income families who reach the top 1% of earners (Opportunity Insights). That share follows students who started around 2000, so it is moved by half of what each school's change in average SAT since then predicts. On My path, the top quarter leaves out money majors the school keeps closed.",
  rep: "How the name lands with employers: U.S. News rank, QS's employer survey, LinkedIn's career-outcomes list, whether the school is a top feeder to Wall Street or Big Tech for that major, and how many finance, tech and consulting jobs sit within about 50 km.",
  jobs: "The share of graduates in the major who are neither working nor in school, and the graduation rate.",
  floor: "Bottom-quarter pay 10 years after starting. A safety net for when things go less well.",
  campus: "Niche's campus, dorm and food grades. Niche counts housing and meal cost in those grades, so that share is added back.",
};

const SOURCES: [string, string, string][] = [
  ["College Scorecard", "Pay by major, share not working, pay quarters, graduation and admit rates, average SAT in 2001 and 2019", "latest release"],
  ["BEA Regional Price Parities", "Price level by state, for the cost-of-living adjustment", "2024"],
  ["Opportunity Insights", "Share reaching the top 1%, from tax records", "1980–82 births"],
  ["U.S. News, QS, LinkedIn", "Rank, employer reputation, career-outcomes list", "2026–27"],
  ["College Transitions", "Top feeders to Wall Street and Big Tech", "2025"],
  ["Census County Business Patterns", "Finance, tech and consulting jobs near campus", "2022"],
  ["School catalogs and advising pages", "How hard each major is to switch into after enrolling", "Nov 2026"],
  ["Niche", "Campus, dorm and food grades; Best Colleges rank (shown, not scored)", "2027"],
  ["Forbes", "America's Top Colleges rank (shown, not scored)", "2027"],
];

export default function Methodology({ count, generated }: { count: number; generated: string }) {
  return (
    <section className="rk-method" id="methodology" aria-labelledby="method-title">
      <h2 id="method-title" className="cf-page-title">How the ranking works</h2>
      <p className="rk-method__lede">
        It asks one question: <strong>if you went here, how well set up would you be for a good career?</strong> Career counts
        75% and campus life 25% by default. Cost, aid and debt never count. Each school is scored on the major you can
        actually reach there where it does best, compared with the same major at the other {count - 1} schools. You can change every weight.
      </p>
      <div className="rk-weights rk-weights--three">
        {(Object.keys(WHAT) as Pillar[]).map((k) => (
          <div className="rk-weight" key={k}>
            <div className="rk-weight__pct">{DEFAULT_WEIGHTS[k]}%</div>
            <h3>{PILLAR_LABELS[k][0]}</h3>
            <p>{WHAT[k]}</p>
          </div>
        ))}
      </div>
      <div className="rk-method__cols">
        <div>
          <h3>Reading the list</h3>
          <ul>
            <li><strong>Score</strong> runs 0 to 100 on this list. 100 is the best school here, not a perfect school.</li>
            <li><strong>Ties.</strong> Schools within 2.5 points share a rank, shown as T-6.</li>
            <li><strong>Small numbers under a rank</strong> show where the school lands if any one career measure is dropped.</li>
            <li><strong>My path</strong> uses the majors you pick. A major you applied to counts directly. Any other counts if switching in after you enroll is open, has a published grade bar of about 3.3 or lower, or admits most applicants.</li>
            <li><strong>Admitted</strong> ranks the schools you marked as admitted in Forge, on the same scale as My path.</li>
            <li><strong>AI My Path</strong> appears if you load your own judged list under Adjust the ranking. It shows your order and reasons next to the formula's rank. It is private to your account.</li>
            <li><strong>U.S. News, Niche and Forbes</strong> ranks are shown for comparison. Niche and Forbes are not scored, because both count cost or debt.</li>
          </ul>
        </div>
        <div>
          <h3>Limits</h3>
          <ul>
            <li>It covers {count} schools so far. More will be added.</li>
            <li>Scorecard pay covers graduates who received federal aid, so it misses some students.</li>
            <li>The top-1% data follows students born 1980–82, and the SAT update is an estimate.</li>
            <li>No public dataset reports internships or co-op for every school, so only nearby jobs count.</li>
            <li>How hard a switch is depends on where you start. The levels here assume you start in a different college at the same school.</li>
            <li>Switching rules were checked by hand at 61 schools, and only for economics, business, computer science, statistics and applied math. Everywhere else a major shows as “not checked” and counts if the school offers it. A school that offers none of your majors ranks below every school that does.</li>
            <li>A school with no Niche campus, dorm and food grades (Caltech) gets no campus score and is ranked on the rest.</li>
            <li>This compares past graduates. It is not a promise about any one student.</li>
          </ul>
        </div>
      </div>
      <details className="rk-details">
        <summary>Sources</summary>
        <div className="rk-tablewrap">
          <table className="rk-sources">
            <thead><tr><th>Source</th><th>What it gives</th><th>Vintage</th></tr></thead>
            <tbody>
              {SOURCES.map(([a, b, c]) => <tr key={a}><td>{a}</td><td>{b}</td><td>{c}</td></tr>)}
            </tbody>
          </table>
        </div>
        <p>Data rebuilt {new Date(generated).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}.</p>
      </details>
    </section>
  );
}
