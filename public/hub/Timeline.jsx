const { Button } = window.CollegeForgeDesignSystem_e95e63;

// The Timeline tab, split into tabs ("#timeline/<tab>"): this week's writing, every date from now through
// spring, the writing schedule per school, the schools still waiting on a round, and aid and scholarship
// dates. The dates and the plan come from timeline-plan.js and writing-schedule.js; this file only draws them.
const TL = window.cfTimelinePlan;
const DP = window.cfDeadlinePlan;
const STEP_LABELS = { outline: "Outline", draft: "Draft", final: "Final pass" };
const STATE_LABELS = { not_started: "Not started", draft: "Drafting" };
const KIND_LABELS = { deadline: "Deadline", related: "Also due", aid: "Aid form", scholarship: "Scholarship", "other-round": "Other round", milestone: "Milestone", decision: "Decision" };

function tlToday() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}
const weekday = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
const essayHref = (id) => "#essays/" + encodeURIComponent(id);
const schoolHref = (slug) => window.cfSchoolDetail.hashFor(slug);
const daysLabel = (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : n < 0 ? `${-n} days ago` : `in ${n} days`);
// This week's steps for one essay: "Outline", "Draft + final pass", or "Write it start to finish".
const stepsLabel = (steps) => (steps.length === 3 ? "Start to finish" : steps.map((s) => STEP_LABELS[s.step]).join(" + "));
const limitLabel = (e) => `${e.limit} ${/character/i.test(e.unit || "") ? "characters" : "words"}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The tab a "#timeline/<tab>" hash names, if it's one of these tabs; else the first. */
function tabFromHash(hash, tabs) {
  const parts = String(hash || "").replace(/^#/, "").split("/");
  const id = parts[0] === "timeline" || parts[0] === "planner" ? parts[1] : "";
  return tabs.some((t) => t.id === id) ? id : tabs[0].id;
}

/** role=tablist with arrow-key, Home and End movement; picking a tab sets "#timeline/<tab>". */
function TimelineTabs({ tabs, current }) {
  const refs = React.useRef({});
  const go = (id, focus) => {
    if (window.location.hash !== "#timeline/" + id) window.location.hash = "timeline/" + id;
    if (focus && refs.current[id]) refs.current[id].focus();
  };
  const onKey = (e) => {
    const i = tabs.findIndex((t) => t.id === current);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    go(tabs[(next + tabs.length) % tabs.length].id, true);
  };
  return (
    <div className="cf-ptabs cf-ptabs--scroll cf-tl-tabs" role="tablist" aria-label="Timeline" onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} type="button" role="tab" id={`tl-tab-${t.id}`} aria-selected={current === t.id} aria-controls={`tl-panel-${t.id}`} tabIndex={current === t.id ? 0 : -1} className={"cf-ptab" + (current === t.id ? " is-active" : "")} onClick={() => go(t.id, false)}>
          {t.label}{t.count != null ? <span className="cf-ptab__n">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

function ThisWeek({ week, schedule, today, needsRound, nextAid }) {
  const next = schedule.groups.filter((g) => g.deadline && g.deadline.date >= today).sort((a, b) => (a.deadline.date < b.deadline.date ? -1 : 1))[0];
  return (
    <React.Fragment>
      {needsRound ? (
        <p className="cf-tl-banner">
          <span><strong>{plural(needsRound, "school")}</strong> still need{needsRound === 1 ? "s" : ""} a round. Until you pick one, the plan aims for the earliest.</span>
          <a href="#timeline/rounds">Pick rounds →</a>
        </p>
      ) : null}
      <section className="cf-tl-week" aria-labelledby="tl-week">
        <div className="cf-tl-week__head">
          <h2 id="tl-week">This week</h2>
          <span className="cf-nums">{TL.shortDate(week.start)} – {TL.shortDate(week.end)}{week.words ? ` · about ${week.words.toLocaleString()} words` : ""}</span>
        </div>
        {week.items.length ? (
          <ol className="cf-tl-week__list">
            {week.items.map((it) => (
              <li key={it.id}>
                <a href={essayHref(it.id)}>
                  <span className="cf-tl-week__steps">{stepsLabel(it.steps)}</span>
                  <span className="cf-tl-week__essay"><strong>{it.label}</strong><span>{it.school}</span></span>
                  <span className="cf-tl-week__by cf-nums">by {weekday(it.steps[it.steps.length - 1].by)} {TL.shortDate(it.steps[it.steps.length - 1].by)}</span>
                </a>
              </li>
            ))}
          </ol>
        ) : (
          <p className="cf-help">Nothing to write this week. Every essay on your list is marked final, or has no prompts saved yet.</p>
        )}
        {next ? <p className="cf-tl-week__next">Next deadline: <a href={next.slug ? schoolHref(next.slug) : "#progress"}>{next.title}</a> <span className="cf-nums">{next.deadline.plan} · {TL.shortDate(next.deadline.date)} ({daysLabel(TL.dayDiff(today, next.deadline.date))})</span></p> : null}
        {nextAid ? <p className="cf-tl-week__next">Next {nextAid.kind === "aid" ? "aid form" : "scholarship date"}: <a href="#timeline/aid">{nextAid.kind === "aid" ? nextAid.form.form : nextAid.sub} for {nextAid.title}</a> <span className="cf-nums">{TL.shortDate(nextAid.date)} ({daysLabel(TL.dayDiff(today, nextAid.date))})</span></p> : null}
      </section>
    </React.Fragment>
  );
}

function PickRound({ rows, onWorkspaceChange }) {
  const [choice, setChoice] = React.useState({});
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const save = async (row) => {
    const deadline = row.options[Number(choice[row.slug] || 0)];
    if (!deadline) return;
    setBusy(row.slug);
    setError("");
    try {
      const ws = await window.cfApi.patch({ collegePatch: { slug: row.slug, deadline: TL.roundChoiceLabel(deadline) } });
      onWorkspaceChange(ws);
    } catch (e) {
      setError(`Couldn't save the round for ${row.title}. Please try again.`);
    } finally { setBusy(""); }
  };
  return (
    <section aria-labelledby="tl-rounds">
      <div className="cf-section-heading"><h2 id="tl-rounds">Pick a round</h2><span>{plural(rows.length, "school")}</span></div>
      <p className="cf-help" style={{ marginBottom: 10 }}>Until you pick a round, the timeline shows every round muted and the writing plan aims for the earliest one.</p>
      {error ? <p role="alert" className="cf-notice">{error}</p> : null}
      <div className="cf-tl-rounds">
        {rows.map((r) => (
          <div className="cf-tl-round" key={r.slug}>
            <a className="cf-tl-round__name" href={schoolHref(r.slug)}>{r.title}</a>
            {r.options.length ? (
              <span className="cf-tl-round__pick">
                <select aria-label={`Round for ${r.title}`} value={choice[r.slug] || 0} disabled={busy === r.slug} onChange={(e) => setChoice({ ...choice, [r.slug]: e.target.value })}>
                  {r.options.map((o, i) => <option key={o.plan + o.date} value={i}>{o.plan} · {TL.shortDate(o.date)}</option>)}
                </select>
                <Button size="sm" variant="secondary" disabled={busy === r.slug} onClick={() => save(r)}>{busy === r.slug ? "Saving…" : "Save"}</Button>
              </span>
            ) : (
              <span className="cf-tl-round__none">No deadlines saved. <a href="#settings">Rebuild deadlines in Settings</a> or ask the copilot.</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function DateRow({ e }) {
  const cls = "cf-tl-event cf-tl-event--" + e.kind + (e.past ? " is-past" : "") + (e.done ? " is-done" : "");
  const href = e.slug ? schoolHref(e.slug) : e.href;
  const title = href ? <a href={href}>{e.title}</a> : e.title;
  // An aid date names its form unless the plan already does ("FAFSA"); a scholarship's plan says enough.
  const sub = e.kind === "aid" && e.form && e.sub.toLowerCase().indexOf(e.form.form.toLowerCase()) < 0 ? `${e.form.form} · ${e.sub}` : e.sub;
  const kind = e.done ? "Submitted" : e.kind === "milestone" && e.mine ? "Your date" : e.kind === "task" ? e.label : KIND_LABELS[e.kind];
  return (
    <li className={cls}>
      <span className="cf-tl-event__date cf-nums"><span>{weekday(e.date)}</span>{TL.shortDate(e.date)}</span>
      <span className="cf-tl-event__body">
        <strong>{title}</strong>
        {sub ? <span>{sub}</span> : null}
      </span>
      <span className="cf-tl-event__kind">{kind}</span>
    </li>
  );
}

/** Months with only the rows the toggles leave, today's marker placed among them. */
function visibleMonths(months, today, showPast, showOther) {
  return months
    .map((m) => {
      const events = m.events.filter((e) => (showPast || !e.past) && (showOther || e.kind !== "other-round"));
      return { ...m, events, todayAt: m.todayAt < 0 ? -1 : events.filter((e) => e.date < today).length };
    })
    .filter((m) => m.events.length || m.todayAt >= 0);
}

function DatesList({ months, today }) {
  const [showPast, setShowPast] = React.useState(false);
  const [showOther, setShowOther] = React.useState(false);
  const all = months.flatMap((m) => m.events);
  const pastCount = all.filter((e) => e.past).length;
  const otherCount = all.filter((e) => e.kind === "other-round" && (showPast || !e.past)).length;
  const shown = visibleMonths(months, today, showPast, showOther);
  const todayRow = <li className="cf-tl-today" key="today"><span className="cf-nums">Today · {weekday(today)} {TL.shortDate(today)}</span></li>;
  return (
    <section aria-labelledby="tl-dates">
      <div className="cf-section-heading"><h2 id="tl-dates">Dates</h2><a href="#share/calendar">Subscribe in your calendar →</a></div>
      {pastCount || otherCount ? (
        <div className="cf-tl-filters">
          {pastCount ? <label><input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Show past <span className="cf-nums">({pastCount})</span></label> : null}
          {otherCount || showOther ? <label><input type="checkbox" checked={showOther} onChange={(e) => setShowOther(e.target.checked)} /> Show other rounds <span className="cf-nums">({otherCount})</span></label> : null}
        </div>
      ) : null}
      <div className="cf-tl-months">
        {shown.map((m) => (
          <section className="cf-tl-month" key={m.key} aria-label={m.label}>
            <h3>{m.label}</h3>
            <ol>
              {m.events.slice(0, Math.max(0, m.todayAt)).map((e, i) => <DateRow e={e} key={"p" + i} />)}
              {m.todayAt >= 0 ? todayRow : null}
              {m.events.slice(Math.max(0, m.todayAt)).map((e, i) => <DateRow e={e} key={"n" + i} />)}
            </ol>
          </section>
        ))}
      </div>
    </section>
  );
}

function AidRows({ rows }) {
  return (
    <ol className="cf-tl-aid__rows">
      {rows.map((e, i) => (
        <li key={e.slug + e.sub + i}>
          <span className="cf-tl-event__date cf-nums"><span>{weekday(e.date)}</span>{TL.shortDate(e.date)}</span>
          <span className="cf-tl-aid__what"><a href={schoolHref(e.slug)}>{e.title}</a>{e.sub !== e.form.form ? <span>{e.sub}</span> : null}</span>
          <span className="cf-tl-aid__form">{e.form.form}</span>
        </li>
      ))}
    </ol>
  );
}

/** Aid forms and scholarship dates, upcoming only, each group with what its forms are. */
function AidPanel({ aid, today, needAid, wantsMerit }) {
  const upcoming = aid.filter((e) => e.date >= today);
  const forms = upcoming.filter((e) => e.kind === "aid");
  const merit = upcoming.filter((e) => e.kind === "scholarship");
  const usedForms = DP.AID_FORMS.filter((f) => forms.some((e) => e.form.id === f.id));
  return (
    <section aria-labelledby="tl-aid">
      <div className="cf-section-heading"><h2 id="tl-aid">{needAid ? "Financial aid" : "Scholarships"}</h2><a href="#track">Which forms each school needs →</a></div>
      {needAid ? (
        <div className="cf-tl-aid">
          <div className="cf-tl-aid__head"><h3>Aid forms</h3><span className="cf-nums">{plural(forms.length, "date")}</span></div>
          {usedForms.length ? <dl className="cf-tl-aid__forms">{usedForms.map((f) => <div key={f.id}><dt>{f.form}</dt><dd>{f.note}</dd></div>)}</dl> : null}
          {forms.length ? <AidRows rows={forms} /> : <p className="cf-tl-aid__empty">No aid form dates saved for your schools. Check each school's aid page; Recs &amp; aid tracks which forms each one needs.</p>}
        </div>
      ) : null}
      {wantsMerit ? (
        <div className="cf-tl-aid">
          <div className="cf-tl-aid__head"><h3>Scholarships</h3><span className="cf-nums">{plural(merit.length, "date")}</span></div>
          <p className="cf-tl-aid__note">{DP.SCHOLARSHIP_FORM.note}</p>
          {merit.length ? <AidRows rows={merit} /> : <p className="cf-tl-aid__empty">No scholarship dates saved for your schools.</p>}
        </div>
      ) : null}
    </section>
  );
}

function SchoolPlan({ g, today }) {
  const head = g.kind === "school" ? <a href={schoolHref(g.slug)}>{g.title}</a> : g.title;
  const due = g.deadline
    ? `${g.deadline.plan} · ${TL.shortDate(g.deadline.date)}${g.deadline.assumed ? " (earliest round, not picked yet)" : ""}`
    : g.kind === "common" ? (g.finishBy ? "Before your first Common App deadline" : "No Common App deadline saved") : "No deadline saved";
  return (
    <section className="cf-tl-school">
      <header>
        <h3>{head}</h3>
        <span className="cf-nums">{due}{g.finishBy ? ` · finish by ${TL.shortDate(g.finishBy)}` : ""}</span>
      </header>
      {g.essays.length ? (
        <ul>
          {g.essays.map((e) => (
            <li key={e.id} className={e.behind ? "is-behind" : ""}>
              <a className="cf-tl-essay" href={essayHref(e.id)}><strong>{e.label}</strong><span>{limitLabel(e)} · {STATE_LABELS[e.state]}</span></a>
              <span className="cf-tl-targets cf-nums">
                {["outline", "draft", "final"].map((s) => (
                  <span key={s} className={e.targets[s] ? "" : "is-done"}>{STEP_LABELS[s]} {e.targets[s] ? TL.shortDate(e.targets[s]) : "✓"}</span>
                ))}
              </span>
              {e.behind ? <span className="cf-tl-behind">Behind: needs more than the plan's pace to finish by {TL.shortDate(g.finishBy || today)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {g.finished.length ? <p className="cf-tl-finished">Finished: {g.finished.map((f, i) => <React.Fragment key={f.id}>{i ? ", " : ""}<a href={essayHref(f.id)}>{f.label}</a></React.Fragment>)}</p> : null}
    </section>
  );
}

function WritingPlan({ schedule, today }) {
  const upcoming = schedule.weeks.slice(0, 8);
  const max = Math.max(1, ...upcoming.map((w) => w.words));
  return (
    <section aria-labelledby="tl-writing">
      <div className="cf-section-heading"><h2 id="tl-writing">Writing schedule</h2><span className="cf-nums">{plural(schedule.weeks.length, "week")} of writing</span></div>
      <p className="cf-help" style={{ marginBottom: 14 }}>Each essay gets an outline, a draft and a final pass, finished three days before its school's deadline; the personal statement comes a week before your first Common App deadline. Essays go earliest deadline first at the steadiest pace that still makes every deadline, so a crunch before an early deadline doesn't pull later schools forward. Marking an essay final on the Essays tab takes it off the plan.</p>
      {upcoming.length ? (
        <ol className="cf-tl-load" aria-label="Words per week">
          {upcoming.map((w) => (
            <li key={w.start}>
              <span className="cf-nums">{w.index === 0 ? "This week" : `Week of ${TL.shortDate(w.start)}`}</span>
              <span className="cf-tl-load__bar" aria-hidden="true"><span style={{ width: `${Math.max(4, Math.round((w.words / max) * 100))}%` }} /></span>
              <span className="cf-nums">{w.words.toLocaleString()} words</span>
              <span className="cf-tl-load__what">{[...new Set(w.items.map((i) => i.school))].join(" · ")}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="cf-tl-schools">
        {schedule.groups.map((g) => <SchoolPlan g={g} today={today} key={g.key} />)}
      </div>
    </section>
  );
}

const NO_ESSAYS = "No essays to plan. Add schools on the shortlist, and their prompts will appear on the Essays tab and here.";

function Timeline({ data, tracker, hash, onWorkspaceChange }) {
  const today = tlToday();
  const apps = (tracker && tracker.apps) || [];
  const dates = React.useMemo(() => TL.timeline(data, apps, today), [data, apps, today]);
  const schedule = React.useMemo(() => window.cfWritingSchedule.writingSchedule(data, apps, today), [data, apps, today]);
  const hasDates = dates.months.some((m) => m.events.length);
  const ob = data.onboarding || {};
  const needAid = !(ob.listPrefs && ob.listPrefs.needAid === false);
  const wantsMerit = !(ob.interview && ob.interview.meritInterest === "no");
  const upcomingAid = dates.aid.filter((e) => e.date >= today);
  const showAid = needAid || (wantsMerit && upcomingAid.length > 0);
  const tabs = [
    { id: "week", label: "This week" },
    { id: "dates", label: "Dates", count: dates.months.reduce((n, m) => n + m.events.filter((e) => !e.past && e.kind !== "other-round").length, 0) },
    { id: "writing", label: "Writing plan", count: schedule.groups.length || null },
    dates.needsRound.length ? { id: "rounds", label: "Pick a round", count: dates.needsRound.length } : null,
    showAid ? { id: "aid", label: needAid ? "Financial aid" : "Scholarships", count: upcomingAid.length } : null,
  ].filter(Boolean);
  const current = tabFromHash(hash, tabs);
  let panel;
  if (current === "week") {
    panel = schedule.groups.length
      ? <ThisWeek week={schedule.thisWeek} schedule={schedule} today={today} needsRound={dates.needsRound.length} nextAid={upcomingAid[0] || null} />
      : <div className="cf-empty">{NO_ESSAYS}</div>;
  } else if (current === "dates") {
    panel = hasDates ? <DatesList months={dates.months} today={today} /> : <div className="cf-empty">No dates yet. Add schools to your list and their deadlines will show here.</div>;
  } else if (current === "writing") {
    panel = schedule.groups.length ? <WritingPlan schedule={schedule} today={today} /> : <div className="cf-empty">{NO_ESSAYS}</div>;
  } else if (current === "rounds") {
    panel = <PickRound rows={dates.needsRound} onWorkspaceChange={onWorkspaceChange} />;
  } else {
    panel = <AidPanel aid={dates.aid} today={today} needAid={needAid} wantsMerit={wantsMerit} />;
  }
  return (
    <div className="cf-page cf-tl">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Timeline</h1>
          <p className="cf-page-lede">Every date from now through spring, and a week-by-week plan that gets each school's essays done before its deadline.</p>
        </div>
      </header>
      <TimelineTabs tabs={tabs} current={current} />
      <div role="tabpanel" id={`tl-panel-${current}`} aria-labelledby={`tl-tab-${current}`} tabIndex={0} className="cf-tl-panel">{panel}</div>
    </div>
  );
}
window.Timeline = Timeline;
