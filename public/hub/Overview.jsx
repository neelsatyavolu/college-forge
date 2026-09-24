const { Button } = window.CollegeForgeDesignSystem_e95e63;

function Overview({ data, onNavigate, onAsk, onStart }) {
  const { applicant, colleges } = data;
  const hasProfile = Boolean(applicant.name && data.profile.intended);
  const draftCount = Object.values(data.essayDrafts || {}).filter(text => String(text).trim()).length;
  const submitted = Object.values(data.applications || {}).filter(a => ["submitted", "accepted", "rejected", "waitlisted", "deferred"].includes(a.status)).length;
  const firstName = (applicant.name || "").trim().split(/\s+/)[0];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const allDates = [
    ...(data.criticalDates || []),
    ...colleges.flatMap(college => window.cfDeadlinePlan.planDeadlines(college).map(deadline => ({ date: deadline.date, label: `${college.short || college.name} — ${deadline.plan}`, detail: college.major || "Confirm on the admissions website" }))),
  ].map(item => ({ ...item, parsed: window.cfTimelineDate(item.date, Number(data.profile.gradYear) || null) }));
  const dates = allDates.filter(item => item.parsed && item.parsed.date >= today).sort((a, b) => a.parsed.date - b.parsed.date).slice(0, 3);
  const undatedCount = allDates.filter(item => !item.parsed).length;
  const steps = [
    { id: "profile", number: "01", title: "Tell your story", text: "Your academics, interests, and everything that makes you you.", done: hasProfile, action: "Build your profile" },
    { id: "recommendations", number: "02", title: "Find your kind of college", text: "Explore options through real outcomes, your interests, and fit.", done: colleges.length > 0, action: "Find colleges" },
    { id: "essays", number: "03", title: "Make your application yours", text: "Start a draft, make a plan, and take it one step at a time.", done: draftCount > 0, action: "Start writing" },
  ];
  const next = steps.find(s => !s.done) || { id: "planner", title: "Keep your momentum", text: "Review your application checklist and choose your next task.", action: "Open your plan" };
  return (
    <div className="cf-page cf-overview">
      <header className="cf-home-header"><div className="cf-eyebrow">YOUR NEXT CHAPTER</div><h1 className="cf-page-title">{firstName ? `You’ve got this, ${firstName}.` : "A college path that feels like you."}</h1><p className="cf-page-lede">From the first possibility to the final application. A little direction, one step at a time.</p></header>
      <section className="cf-next-step" aria-labelledby="next-step-title">
        <div><div className="cf-eyebrow">{hasProfile ? "YOUR NEXT STEP" : "LET’S START WITH YOU"}</div><h2 id="next-step-title">{next.title}</h2><p>{next.text}</p><div className="cf-inline-actions"><Button onClick={() => !applicant.name ? onStart() : onNavigate(next.id)}>{!applicant.name ? "Set up my workspace" : next.action} <span aria-hidden="true">→</span></Button>{!applicant.name && <a href="#recommendations">Explore colleges first</a>}</div></div>
        <div className="cf-path-art" aria-hidden="true"><span className="cf-path-orbit orbit-one" /><span className="cf-path-orbit orbit-two" /><span className="cf-path-star">✳</span><span className="cf-path-caption">YOUR PATH.<br />YOUR PACE.</span></div>
      </section>
      <section className="cf-progress-strip" aria-label="Application progress">
        {[["Schools saved", colleges.length, "shortlist"], ["Drafts started", draftCount, "essays"], ["Applications sent", submitted, "shortlist"]].map(([label, value, target]) => <a key={label} href={"#" + target}><span className="cf-progress-value">{String(value).padStart(2, "0")}</span><span>{label}</span><span aria-hidden="true">↗</span></a>)}
      </section>
      <section className="cf-home-section"><div className="cf-section-heading"><h2>Your path, in three steps</h2><span>No need to do it all today.</span></div><div className="cf-journey-grid">{steps.map(step => <a key={step.id} href={"#" + step.id} className="cf-journey-card"><div className="cf-journey-top"><span>{step.number}</span><span className={step.done ? "cf-step-done" : ""}>{step.done ? "Started ✓" : "↗"}</span></div><h3>{step.title}</h3><p>{step.text}</p><span className="cf-text-action">{step.action} →</span></a>)}</div></section>
      <div className="cf-home-columns">
        <section className="cf-home-section"><div className="cf-section-heading"><h2>Coming up</h2><a href="#timeline">All dates →</a></div><div className="cf-agenda">{dates.length ? dates.map((date, i) => <a href="#timeline" className="cf-agenda-row" key={i}><div className="cf-date-block"><span>{date.parsed.date.toLocaleDateString("en-US", { month: "short" })}</span><strong>{date.parsed.date.getDate()}</strong></div><div><h3>{date.label}</h3><p>{(date.detail || String(date.parsed.date.getFullYear())) + (date.parsed.inferred ? " · year inferred" : "")}</p></div></a>) : <div className="cf-friendly-empty"><span aria-hidden="true">□</span><h3>A little planning goes a long way.</h3><p>{undatedCount ? `${undatedCount} saved date${undatedCount === 1 ? " needs" : "s need"} a year or clearer date. Review your timeline to place them here.` : "Add a deadline or a personal milestone. You’ll see what’s coming here."}</p><a href="#timeline">Review your dates →</a></div>}</div></section>
        <section className="cf-home-section"><div className="cf-section-heading"><h2>A better starting point</h2></div><div className="cf-insight-card"><div className="cf-eyebrow">BEYOND A PRESTIGE LIST</div><h3>Good outcomes.<br />Room for your priorities.</h3><p>Our college recommendations use graduate purchasing power and reputation data. See the evidence, weigh the tradeoffs, and make the list your own.</p><a href="#recommendations" className="cf-text-action">See colleges for you →</a><button type="button" className="cf-quiet-button" onClick={() => onAsk("Help me build a balanced college list from my profile and the ranking evidence. Explain the evidence and what we still need to verify.")}>Talk it through with the copilot ↗</button></div></section>
      </div>
    </div>
  );
}
window.Overview = Overview;
