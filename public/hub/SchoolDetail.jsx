const { Badge, VerdictBadge, Button } = window.CollegeForgeDesignSystem_e95e63;

// One shortlist school on its own page ("#shortlist/<slug>"): what it means for this student (major, chances,
// scores, cost, testing), their application there (round, deadlines, status, supplements) and every saved
// research fact. Only data Forge already has; a missing number is left out or shown as "—".

const SD = window.cfSchoolDetail;
const SD_TIER = { reach: { label: "Reach", tone: "var(--error)" }, target: { label: "Target", tone: "var(--accent-amber)" }, safety: { label: "Likely", tone: "var(--accent-teal)" } };
const SD_POSITION = { below: "below", within: "inside", above: "above" };
const SD_ESSAY_TONE = { final: "var(--success)", draft: "var(--accent-amber)", "not started": "var(--muted-soft)" };
const SD_ESSAY_LABEL = { final: "Final", draft: "Draft", "not started": "Not started" };
const SD_PLAN = { send: "Send scores", withhold: "Apply without scores", undecided: "Not decided" };
const SD_TP_TONE = { send: "var(--success)", your_call: "var(--accent-amber)", consider_withholding: "var(--coral)" };

const isLink = (u) => /^https?:\/\//.test(u || "");
const sdDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? window.cfApp.fmtDate(iso, { year: true }) : iso || "");

function SourceLink({ url, label }) {
  return isLink(url) ? <a className="cf-sd-source" href={url} target="_blank" rel="noopener noreferrer">{label || "source"}</a> : null;
}

/** A researched fact's value with its cycle, third-party flag and source. */
function FactValue({ fact }) {
  if (!fact) return null;
  const cycle = SD.cycleTag(fact.cycle);
  return (
    <React.Fragment>
      {fact.value}{" "}
      <SourceLink url={fact.sourceUrl} />
      {cycle ? <span className="cf-research-tag">{cycle}</span> : null}
      {fact.thirdParty ? <span className="cf-research-tag">third-party</span> : null}
    </React.Fragment>
  );
}

/** Label/value rows; rows whose value is null are left out, and a section with none isn't drawn. */
function Rows({ rows }) {
  const shown = rows.filter((r) => r && r[1] != null && r[1] !== false && r[1] !== "");
  if (!shown.length) return null;
  return (
    <dl className="cf-sd-rows">
      {shown.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}

function Section({ id, title, note, children }) {
  return (
    <section className="cf-sd-section" aria-labelledby={id}>
      <div className="cf-sd-section__head">
        <h2 id={id} className="cf-display">{title}</h2>
        {note ? <span className="cf-sd-note cf-nums">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

function useSchoolInsights(slug) {
  const [state, setState] = React.useState({ loading: true, data: null, error: "" });
  React.useEffect(() => {
    let live = true;
    setState({ loading: true, data: null, error: "" });
    window.cfApi.schoolInsights(slug)
      .then((data) => { if (live) setState({ loading: false, data, error: "" }); })
      .catch((e) => { if (live) setState({ loading: false, data: null, error: e.message || "Couldn't load your fit for this school." }); });
    return () => { live = false; };
  }, [slug]);
  return state;
}

function useScattergram(slug) {
  const [college, setCollege] = React.useState(null);
  React.useEffect(() => {
    let live = true;
    window.cfApi.getScattergrams()
      .then((doc) => { if (live) setCollege(doc && doc.colleges ? { doc, row: doc.colleges[slug] || null } : null); })
      .catch(() => { if (live) setCollege(null); });
    return () => { live = false; };
  }, [slug]);
  return college;
}

function MajorValue({ data, college, insights }) {
  const intended = String((data.profile && data.profile.intended) || "").trim();
  if (!intended) return <span>— <a href="#profile">Add your intended major</a> to see how this school handles it.</span>;
  const fit = insights && insights.major;
  const note = SD.factFor(college.research && college.research.facts, "major_notes");
  return (
    <div className="cf-sd-stack">
      <span><strong>{intended}</strong>{college.major && college.major !== intended ? <span className="cf-sd-muted"> · applying to {college.major}</span> : null}</span>
      {fit && fit.offered === true ? <span>Forge’s career data shows graduates in this major here.</span> : null}
      {fit && fit.offered === false ? <span>Forge’s career data shows no graduates in a matching major here. Check the school’s program list.</span> : null}
      {fit && fit.switching.length ? fit.switching.map((s) => (
        <span key={s.major}>Getting into {s.major} after you enroll: <span className="cf-badge" style={{ "--tone": s.level >= 3 ? "var(--coral)" : s.level >= 2 ? "var(--accent-amber)" : "var(--success)" }}>{s.label}</span></span>
      )) : null}
      {fit && fit.offered && !fit.checked ? <span className="cf-sd-muted">Switching rules for this school haven’t been checked.</span> : null}
      {note ? <span><FactValue fact={note} /></span> : null}
    </div>
  );
}

function ChanceValue({ odds, oddsStale, insights }) {
  const fit = insights && insights.fit;
  const OddsLine = window.cfOdds && window.cfOdds.OddsLine;
  if (!odds && !fit) return <span>— <span className="cf-sd-muted">Estimate your chances from Your shortlist.</span></span>;
  return (
    <div className="cf-sd-stack">
      {odds && OddsLine ? <div className="cf-sd-odds"><OddsLine odds={odds} stale={oddsStale} /></div> : null}
      {fit ? (
        <span>
          Forge’s planning category: <strong>{fit.label}</strong>
          {fit.reasons.length ? <span className="cf-sd-muted"> · {fit.reasons[0]}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

function ScoresValue({ college, insights }) {
  const rows = (insights && insights.comparisons) || [];
  const facts = college.research && college.research.facts;
  const sat = SD.factFor(facts, "sat_mid50");
  const act = SD.factFor(facts, "act_mid50");
  const gpa = SD.factFor(facts, "gpa_note");
  if (!rows.length && !sat && !act && !gpa) return null;
  return (
    <div className="cf-sd-stack">
      {rows.map((r) => (
        <span key={r.label} className="cf-nums">
          Your {r.fromAct ? "ACT (as SAT)" : r.label} <strong>{r.yours}</strong> is {SD_POSITION[r.position]} the {r.theirs}
        </span>
      ))}
      {sat && !rows.some((r) => r.label === "SAT") ? <span>SAT middle 50%: <FactValue fact={sat} /></span> : null}
      {act ? <span>ACT middle 50%: <FactValue fact={act} /></span> : null}
      {gpa && !rows.some((r) => r.label === "GPA") ? <span>GPA: <FactValue fact={gpa} /></span> : null}
    </div>
  );
}

function costLabel(cost) {
  if (cost.basis === "full") {
    const where = cost.residency ? `${cost.residency} ` : "";
    return cost.text.charAt(0) === "$" ? ` a year, the full ${where}cost: you aren't applying for need-based aid` : ": you aren't applying for need-based aid, so you'd pay the full cost";
  }
  const perYear = /a year/i.test(cost.text) ? "" : " a year";
  return cost.fact && cost.income ? `${perYear} for family incomes ${cost.income}` : `${perYear}, estimated`;
}

function CostValue({ college, prefs, place }) {
  const cost = SD.costForYou(college, prefs, place);
  const sticker = SD.factFor(college.research && college.research.facts, "sticker_cost");
  if (!cost && !sticker && !college.coa) return null;
  return (
    <div className="cf-sd-stack">
      {cost ? (
        <span className="cf-nums">
          <strong>{cost.text}</strong><span className="cf-sd-muted">{costLabel(cost)}</span>
          {cost.fact ? <React.Fragment>{" "}<SourceLink url={cost.fact.sourceUrl} />{SD.cycleTag(cost.fact.cycle) ? <span className="cf-research-tag">{SD.cycleTag(cost.fact.cycle)}</span> : null}</React.Fragment> : null}
        </span>
      ) : null}
      {cost && cost.fits === true ? <span style={{ color: "var(--success)" }}>Within your budget of {cost.budget}</span> : null}
      {cost && cost.fits === false ? <span style={{ color: "var(--coral)" }}>Above your budget of {cost.budget}</span> : null}
      {sticker ? <span>Sticker price: <FactValue fact={sticker} /></span> : college.coa ? <span className="cf-nums">Sticker price: {college.coa}</span> : null}
    </div>
  );
}

function AidValue({ college }) {
  const facts = college.research && college.research.facts;
  const rows = [["Need-based aid", "meets_full_need"], ["CSS Profile", "css_profile"], ["Merit aid", "merit_aid"]]
    .map(([label, key]) => [label, SD.factFor(facts, key)]).filter(([, f]) => f);
  if (!rows.length) return null;
  return <div className="cf-sd-stack">{rows.map(([label, f]) => <span key={label}>{label}: <FactValue fact={f} /></span>)}</div>;
}

function TestingValue({ college, tracked }) {
  const tp = tracked && tracked.testingPlan;
  const policy = SD.factFor(college.research && college.research.facts, "test_policy");
  if (tp && tp.recommendation) {
    return (
      <div className="cf-sd-stack">
        <span className="cf-sd-inline"><span className="cf-badge" style={{ "--tone": SD_TP_TONE[tp.recommendation.advice] || "var(--muted-soft)" }}>{tp.recommendation.label}</span> {tp.recommendation.reason}</span>
        <span>Your plan: <strong>{SD_PLAN[tp.choice.plan] || SD_PLAN.undecided}</strong> · <a href={`#progress/app-${encodeURIComponent(tracked.id)}`}>change it on Progress</a></span>
        {policy ? <span className="cf-sd-muted">Policy: <FactValue fact={policy} /></span> : null}
      </div>
    );
  }
  if (policy) return <span><FactValue fact={policy} /></span>;
  return college.testPolicy || null;
}

/** Admission rounds and their materials; aid and scholarship dates have their own row (AidDeadlinesValue). */
function DeadlinesValue({ college }) {
  const chosen = SD.chosenRound(college);
  const deadlines = (college.deadlines || []).filter((d) => d && d.plan && !window.cfDeadlinePlan.aidKind(d.plan));
  return (
    <div className="cf-sd-stack">
      <span>{chosen ? <strong>{chosen.label}</strong> : <span>Round not chosen yet. <span className="cf-sd-muted">Ask the copilot to pick rounds, or choose one on Progress.</span></span>}</span>
      {deadlines.length ? (
        <ul className="cf-sd-deadlines">
          {deadlines.map((d) => {
            const on = chosen && d.plan.trim().toLowerCase() === chosen.plan.toLowerCase();
            return <li key={d.plan + d.date} className={on ? "is-chosen" : ""}><span>{d.plan}</span><span className="cf-nums">{sdDate(d.date)}{d.projectedFrom ? " (est.)" : ""}</span>{on ? <span className="cf-sd-chosen">your round</span> : null}</li>;
          })}
        </ul>
      ) : <span className="cf-sd-muted">No deadlines saved yet.</span>}
    </div>
  );
}

/**
 * The school's aid-form and scholarship dates, grouped, each with its form and a line on what it is. Dates the
 * student opted out of (not applying for aid, no to merit money) are left out; null when none are left.
 */
function AidDeadlinesValue({ college, data }) {
  const DP = window.cfDeadlinePlan;
  const rows = DP.visibleDeadlines(college.deadlines, data).filter((d) => d.plan && DP.aidKind(d.plan))
    .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!rows.length) return null;
  const groups = [["aid", "Financial aid"], ["scholarship", "Scholarships"]]
    .map(([kind, title]) => ({ kind, title, rows: rows.filter((d) => DP.aidKind(d.plan) === kind) }))
    .filter((g) => g.rows.length);
  return (
    <div className="cf-sd-stack cf-sd-aid">
      {groups.map((g) => (
        <div key={g.kind}>
          <p className="cf-sd-aid__title">{g.title}</p>
          <ul className="cf-sd-aidlist">
            {g.rows.map((d) => {
              const form = DP.aidForm(d.plan);
              return (
                <li key={d.plan + d.date}>
                  <span><strong>{form.id === "scholarship" ? d.plan : form.form}</strong>{form.id !== "scholarship" && d.plan.toLowerCase().indexOf(form.form.toLowerCase()) < 0 ? <span className="cf-sd-muted"> · {d.plan}</span> : null}<span className="cf-sd-aid__note">{form.note}</span></span>
                  <span className="cf-nums">{sdDate(d.date)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function StatusValue({ college, tracked, onTrack, busy }) {
  if (tracked) return <span><strong>{tracked.statusLabel}</strong> · <a href="#progress">Open on Progress →</a></span>;
  return (
    <span className="cf-sd-inline">
      <span className="cf-sd-muted">Not tracked yet.</span>
      {onTrack ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => onTrack(college)}>Track application</Button> : null}
    </span>
  );
}

function EarlyValue({ college }) {
  const fact = SD.factFor(college.research && college.research.facts, "ed_ea_options");
  const plans = (college.plans || []).filter((p) => p && p.plan && p.rate);
  if (!fact && !plans.length) return null;
  return (
    <div className="cf-sd-stack">
      {fact ? <span><FactValue fact={fact} /></span> : null}
      {plans.length ? <span className="cf-nums">Admit rate by round: {plans.map((p) => `${p.plan} ${p.rate}`).join(" · ")}</span> : null}
    </div>
  );
}

function InterestValue({ college, tracked, factKey }) {
  const fact = SD.factFor(college.research && college.research.facts, factKey);
  const signal = tracked && tracked.interestSignal;
  const logged = signal ? (factKey === "interview" ? signal.interviewsLogged : signal.logged) : 0;
  if (!fact && !logged) return null;
  return (
    <div className="cf-sd-stack">
      {fact ? <span><FactValue fact={fact} /></span> : null}
      {logged ? <span className="cf-sd-muted cf-nums">{logged} logged on Portals</span> : null}
    </div>
  );
}

function Supplements({ data, college }) {
  const { skipped, items } = SD.supplementsFor(data, college);
  if (college.supplementsNeeded === "no" && !items.length) return <p className="cf-sd-empty">No supplemental essays for this school.</p>;
  if (skipped) return <p className="cf-sd-empty">You’re not writing supplements for this school. <a href="#essays">Change that on Essays</a>.</p>;
  if (!items.length) return <p className="cf-sd-empty">No supplement prompts saved yet. <a href="#essays">Open Essays</a> to add them, or ask the copilot to look them up.</p>;
  const done = items.filter((e) => e.status === "final").length;
  return (
    <div>
      <p className="cf-sd-subhead cf-nums">Supplements · {done} of {items.length} final</p>
      <ul className="cf-sd-essays">
        {items.map((e) => (
          <li key={e.id}>
            <div className="cf-sd-essay__top">
              <strong>{e.label}</strong>
              <span className="cf-badge" style={{ "--tone": SD_ESSAY_TONE[e.status] }}>{SD_ESSAY_LABEL[e.status]}</span>
              {!e.required ? <span className="cf-research-tag">optional</span> : null}
            </div>
            {e.prompt ? <p className="cf-sd-essay__prompt">{e.prompt}</p> : null}
            <div className="cf-sd-essay__foot cf-nums">
              <span>{e.count}{e.limit ? ` / ${e.limit}` : ""} {e.unit}</span>
              <a href={`#essays/${encodeURIComponent(e.id)}`}>{e.status === "not started" ? "Start in Essays →" : "Open in Essays →"}</a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResearchSection({ research, prefs }) {
  const groups = SD.researchGroups(research && research.facts, prefs);
  if (!groups.length) {
    return <Section id="sd-research" title="Research facts"><p className="cf-sd-empty">No research saved for this school yet. Setup research or the copilot adds sourced facts here.</p></Section>;
  }
  const count = groups.reduce((n, g) => n + g.rows.length, 0);
  return (
    <Section id="sd-research" title="Research facts" note={`${count} facts${research.checkedAt ? ` · checked ${research.checkedAt}` : ""}`}>
      {research.needsReview ? <p className="cf-sd-empty" style={{ color: "var(--coral)" }}>Some facts still need checking.</p> : null}
      <div className="cf-sd-research">
        {groups.map((g) => (
          <div key={g.title} className="cf-sd-research__group">
            <h3>{g.title}</h3>
            <dl className="cf-sd-rows cf-sd-rows--tight">
              {g.rows.map(({ label, fact }, i) => <div key={label + i}><dt>{label}</dt><dd><FactValue fact={fact} /></dd></div>)}
            </dl>
          </div>
        ))}
      </div>
    </Section>
  );
}

function SchoolDetail({ college, data, tracked, odds, oddsStale, onTrack, busy, notice }) {
  const insights = useSchoolInsights(college.slug);
  const scatter = useScattergram(college.slug);
  const headingRef = React.useRef(null);
  React.useEffect(() => {
    window.scrollTo(0, 0);
    if (headingRef.current) headingRef.current.focus({ preventScroll: true });
    const before = document.title;
    document.title = `${college.name || college.short} · College Forge`;
    return () => { document.title = before; };
  }, [college.slug]);
  const info = insights.data;
  const prefs = (data.onboarding && data.onboarding.listPrefs) || {};
  const tier = SD_TIER[college.tier];
  const setting = college.setting || (info && info.setting);
  const place = { residency: (data.profile && data.profile.residency) || "", state: (info && info.explore && info.explore.state) || null };
  const cost = SD.costForYou(college, prefs, place);
  const SchoolMark = window.cfApp.SchoolMark;
  const CollegeScatter = window.cfScatter && window.cfScatter.CollegeScatter;
  const student = scatter && window.cfScatter ? window.cfScatter.studentMarker(scatter.doc, data.applicant || {}) : null;
  const stats = [
    ["Admission rate", college.admit || "—"],
    ["Your likely cost", cost ? cost.text : "—"],
    ["Round", SD.chosenRound(college) ? SD.chosenRound(college).plan : "Not chosen"],
    ["Status", tracked ? tracked.statusLabel : "Not tracked"],
  ];

  return (
    <div className="cf-page cf-sd">
      <a className="cf-sd-back" href="#shortlist">← Your shortlist</a>
      <header className="cf-sd-head">
        <span className="cf-sd-mark"><SchoolMark name={college.name || college.short} logo={(tracked && tracked.logo) || (info && info.logo) || null} /></span>
        <div className="cf-sd-head__text">
          <h1 ref={headingRef} tabIndex={-1} className="cf-page-title cf-sd-title">{college.name || college.short}</h1>
          <p className="cf-sd-meta">
            {[college.location, setting].filter(Boolean).join(" · ") || "—"}
          </p>
          <div className="cf-sd-badges">
            {tier ? <span className="cf-badge" style={{ "--tone": tier.tone }}>{tier.label}</span> : <span className="cf-badge">Not assessed</span>}
            {college.priority ? <Badge variant="coral" uppercase>Priority</Badge> : null}
            {SD.isUc(college) ? <Badge variant="teal" uppercase>UC Application</Badge> : null}
            {college.verdict && !/^(reach|target|safety|likely)$/i.test(String(college.verdict.label || "").trim()) ? <VerdictBadge tone={college.verdict.tone}>{college.verdict.label}</VerdictBadge> : null}
            {isLink(college.url) ? <a className="cf-sd-source" href={college.url} target="_blank" rel="noopener noreferrer">School website ↗</a> : null}
            {info && info.explore ? <a className="cf-sd-source" href={`#explore/${encodeURIComponent(info.explore.slug)}`}>Campus, programs &amp; net price calculator →</a> : null}
          </div>
        </div>
      </header>

      <dl className="cf-sd-stats">
        {stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="cf-display cf-nums">{value}</dd></div>)}
      </dl>

      <div role="status" aria-live="polite" className="cf-sd-notice">{notice || ""}</div>

      <Section id="sd-for-you" title="For you" note={insights.loading ? "Loading your fit…" : insights.error ? insights.error : null}>
        <Rows rows={[
          ["Your major", <MajorValue data={data} college={college} insights={info} />],
          ["Your chances", <ChanceValue odds={odds} oddsStale={oddsStale} insights={info} />],
          ["Your scores", ScoresValue({ college, insights: info })],
          ["Your likely cost", CostValue({ college, prefs, place })],
          ["Aid", AidValue({ college })],
          ["Testing", TestingValue({ college, tracked })],
          ["Past applicants from your school", scatter && scatter.row && CollegeScatter
            ? <div className="cf-sd-scatter"><CollegeScatter college={scatter.row} student={student} /></div> : null],
        ]} />
      </Section>

      <Section id="sd-application" title="Application">
        <Rows rows={[
          ["Round and deadlines", <DeadlinesValue college={college} />],
          ["Aid and scholarship dates", AidDeadlinesValue({ college, data })],
          ["Status", <StatusValue college={college} tracked={tracked} onTrack={onTrack} busy={busy} />],
          ["Early rounds", EarlyValue({ college })],
          ["Interview", InterestValue({ college, tracked, factKey: "interview" })],
          ["Does a visit or email matter here?", InterestValue({ college, tracked, factKey: "demonstrated_interest" })],
          ["Application fee", college.fee || null],
        ]} />
        <Supplements data={data} college={college} />
      </Section>

      <ResearchSection research={college.research} prefs={prefs} />
    </div>
  );
}

window.SchoolDetail = SchoolDetail;
