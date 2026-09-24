import type { Metadata } from "next";
import rankings from "@/public/data/rankings/top250.json";
import { THEME_BOOTSTRAP } from "@/lib/theme-bootstrap";
import "./landing.css";

export const metadata: Metadata = {
  title: "College Forge · Plan your college applications",
  description:
    "A free workspace for your college applications: a list built on graduate outcomes, essays against the real prompts, and every deadline on one timeline.",
};

const HUB = "/hub/index.html";

type Kind = "deadline" | "milestone";
type Pin = { date: string; label: string; detail: string; kind: Kind; side: "up" | "down" };

// A sample senior's fall. Positions are computed from the dates below.
const SEASON_START = Date.UTC(2026, 8, 1);
const SEASON_END = Date.UTC(2027, 0, 10);
const MONTHS = [
  { label: "September", at: Date.UTC(2026, 8, 1) },
  { label: "October", at: Date.UTC(2026, 9, 1) },
  { label: "November", at: Date.UTC(2026, 10, 1) },
  { label: "December", at: Date.UTC(2026, 11, 1) },
  { label: "January", at: Date.UTC(2027, 0, 1) },
];
const PINS: (Pin & { at: number })[] = [
  { at: Date.UTC(2026, 8, 15), date: "Sep 15", label: "Ask two teachers for letters", detail: "Tracked until both are sent", kind: "milestone", side: "up" },
  { at: Date.UTC(2026, 9, 1), date: "Oct 1", label: "Personal statement final", detail: "Common App, 650 words", kind: "milestone", side: "down" },
  { at: Date.UTC(2026, 9, 15), date: "Oct 15", label: "UNC Chapel Hill", detail: "Early action", kind: "deadline", side: "up" },
  { at: Date.UTC(2026, 10, 1), date: "Nov 1", label: "Dartmouth, Michigan", detail: "Early decision I, early action", kind: "deadline", side: "down" },
  { at: Date.UTC(2026, 11, 1), date: "Dec 1", label: "Supplements drafted", detail: "For five regular decision schools", kind: "milestone", side: "up" },
  { at: Date.UTC(2027, 0, 1), date: "Jan 1", label: "Regular decision", detail: "Five schools", kind: "deadline", side: "down" },
];

// Holds the timeline's draw-in until its rule scrolls into view. The flag lives on <html>,
// which the root layout already exempts from hydration checks.
const PLAY_ON_VIEW = `(function(){var t=document.querySelector(".lp-track__rule"),h=document.documentElement;if(!t||!("IntersectionObserver" in window)||t.getBoundingClientRect().top<innerHeight*0.85)return;h.setAttribute("data-lp-waiting","");var o=new IntersectionObserver(function(e){if(e[0].isIntersecting){h.removeAttribute("data-lp-waiting");o.disconnect();}},{rootMargin:"0px 0px -15% 0px"});o.observe(t);})();`;

const pct = (t: number) => `${(((t - SEASON_START) / (SEASON_END - SEASON_START)) * 100).toFixed(2)}%`;

const FEATURES = [
  {
    title: "Colleges for you",
    body: `Recommendations drawn from ${rankings.n_ranked.toLocaleString("en-US")} ranked colleges, filtered by region and setting. Schools are sorted into reach, target and likely only where admissions data supports it. Where evidence is missing, Forge says so instead of guessing.`,
  },
  {
    title: "Essays",
    body: "The 2026–27 Common App prompts and each school’s supplements, with their word limits. Drafts save as you type.",
  },
  {
    title: "Deadlines and paperwork",
    body: "Rounds and school deadlines on one timeline, a checklist that remembers what’s done, recommendation letters, scholarships, and FAFSA and CSS Profile steps with links to the official sites.",
  },
  {
    title: "Your counselor, in the loop",
    body: "Send a read-only link they can comment on, or export a brief, a calendar file or paste-ready text for your applications.",
  },
];

const TRUST = [
  {
    title: "No sign-up",
    body: "Your workspace belongs to this browser. A recovery code opens it on another device.",
  },
  {
    title: "Your AI, or none",
    body: "Connect your own Grok or ChatGPT account and the copilot can read your transcript, fill in your profile and build your plan. Everything also works by hand.",
  },
  {
    title: "Nothing submitted for you",
    body: "Forge isn’t connected to the Common App and never signs in anywhere on your behalf. You paste in what you wrote.",
  },
];

const money = (n: number) => `$${Math.round(n / 100) / 10}k`;
const rate = (n: number) => `${Math.round(n * 100)}%`;
const TOP = [...rankings.schools].sort((a, b) => a.rank_partial - b.rank_partial).slice(0, 5);

export default function LandingPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=DM+Sans:wght@400;500;600;700&display=swap"
      />
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/styles.css" />
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/hub/workspace.css" />

      <div className="lp">
        <header className="lp-nav">
          <a href="/" className="cf-brand"><span aria-hidden="true">✱</span>College Forge</a>
          <nav aria-label="Main">
            <a href="/rankings" className="lp-nav__rankings">Rankings</a>
            <a href={HUB} className="lp-nav__cta">Open your workspace</a>
          </nav>
        </header>

        <main>
          <section className="lp-hero" aria-labelledby="lp-title">
            <h1 id="lp-title">Plan your college applications, from first list to last deadline.</h1>
            <div className="lp-hero__side">
              <p>
                Forge is a free workspace for high school seniors. Build a college list from how graduates actually did,
                draft essays against the real prompts, and keep every deadline, letter and form in one place.
              </p>
              <div className="lp-actions">
                <a className="lp-btn lp-btn--primary" href={HUB}>Open your workspace</a>
                <a className="lp-btn" href="/rankings">Browse the rankings</a>
              </div>
              <p className="lp-note">Free, with no account to create.</p>
            </div>
          </section>

          <section className="lp-season" aria-labelledby="lp-season-title">
            <div className="lp-season__head">
              <h2 id="lp-season-title">The whole season on one line</h2>
              <p>
                A sample fall. Forge builds yours from your list: which round for each school, their deadlines, and the
                essays and letters that have to land before them.
              </p>
            </div>
            <div className="lp-track" role="list">
              <div className="lp-track__rule" aria-hidden="true" />
              {MONTHS.map((m) => (
                <span key={m.label} className="lp-track__month" style={{ left: pct(m.at) }} aria-hidden="true">{m.label}</span>
              ))}
              {PINS.map((p, i) => (
                <div
                  key={p.date}
                  role="listitem"
                  className={`lp-pin lp-pin--${p.kind} lp-pin--${p.side}${i === PINS.length - 1 ? " lp-pin--end" : ""}`}
                  style={{ left: pct(p.at), animationDelay: `${300 + i * 110}ms` }}
                >
                  <span className="lp-pin__dot" aria-hidden="true" />
                  <span className="lp-pin__text">
                    <time>{p.date}</time>
                    <strong>{p.label}</strong>
                    <span>{p.detail}</span>
                  </span>
                </div>
              ))}
            </div>
            <script dangerouslySetInnerHTML={{ __html: PLAY_ON_VIEW }} />
            <ul className="lp-legend" aria-label="Legend">
              <li><span className="lp-legend__dot lp-legend__dot--deadline" aria-hidden="true" />School deadline</li>
              <li><span className="lp-legend__dot lp-legend__dot--milestone" aria-hidden="true" />Your milestone</li>
            </ul>
          </section>

          <section className="lp-features" aria-labelledby="lp-features-title">
            <h2 id="lp-features-title">What’s in the workspace</h2>
            <dl>
              {FEATURES.map((f) => (
                <div key={f.title} className="lp-feature">
                  <dt>{f.title}</dt>
                  <dd>{f.body}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="lp-rank" aria-labelledby="lp-rank-title">
            <div className="lp-rank__copy">
              <h2 id="lp-rank-title">A ranking built on what happened to graduates</h2>
              <p>
                Colleges are ranked on early-career earnings compared with graduates of the same major elsewhere, plus
                graduation and employment rates. Admit rate, test scores and reputation get no weight.
              </p>
              <p className="lp-rank__links">
                <a href="/rankings">See all {rankings.n_ranked.toLocaleString("en-US")} colleges</a>
                <a href="/rankings#methodology">How the ranking works</a>
              </p>
            </div>
            <figure className="lp-rank__table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    <th scope="col">College</th>
                    <th scope="col" className="lp-num">Early earnings</th>
                    <th scope="col" className="lp-num">Graduation</th>
                  </tr>
                </thead>
                <tbody>
                  {TOP.map((s) => (
                    <tr key={s.unitid}>
                      <td className="lp-rank__n">{s.rank_partial}</td>
                      <th scope="row">{s.institution}<span>{s.city}, {s.state}</span></th>
                      <td className="lp-num">{money(s.typical_earnings)}</td>
                      <td className="lp-num">{rate(s.graduation_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <figcaption>
                Typical earnings about four years after graduating, in 2024 dollars. From the U.S. Department of
                Education’s College Scorecard.
              </figcaption>
            </figure>
          </section>

          <section className="lp-trust" aria-label="Privacy and AI">
            {TRUST.map((t) => (
              <div key={t.title}>
                <h3>{t.title}</h3>
                <p>{t.body}</p>
              </div>
            ))}
          </section>

          <section className="lp-close" aria-labelledby="lp-close-title">
            <h2 id="lp-close-title">Start with what you know. Change anything later.</h2>
            <a className="lp-btn lp-btn--primary" href={HUB}>Open your workspace</a>
          </section>
        </main>

        <footer className="lp-foot">
          <span>College Forge. Room to find your own path.</span>
          <nav aria-label="Footer">
            <a href="/rankings">Rankings</a>
            <a href="/rankings#methodology">Methodology</a>
            <a href={HUB}>Workspace</a>
          </nav>
        </footer>
      </div>
    </>
  );
}
