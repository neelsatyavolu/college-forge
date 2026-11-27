const { Button } = window.CollegeForgeDesignSystem_e95e63;

// The Timeline tab: this week's writing, the schools still waiting on a round, every date from now through
// spring, and a writing schedule per school. The dates and the plan come from timeline-plan.js and
// writing-schedule.js; this file only draws them.
const TL = window.cfTimelinePlan;
const STEP_LABELS = { outline: "Outline", draft: "Draft", final: "Final pass" };
const STATE_LABELS = { not_started: "Not started", draft: "Drafting" };
const KIND_LABELS = { deadline: "Deadline", related: "Also due", "other-round": "Other round", milestone: "Milestone", decision: "Decision" };

function tlToday() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}
const weekday = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
const essayHref = (id) => "#essays/" + encodeURIComponent(id);
const schoolHref = (slug) => "#shortlist/school-" + slug;
const daysLabel = (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : n < 0 ? `${-n} days ago` : `in ${n} days`);
// This week's steps for one essay: "Outline", "Draft + final pass", or "Write it start to finish".
const stepsLabel = (steps) => (steps.length === 3 ? "Start to finish" : steps.map((s) => STEP_LABELS[s.step]).join(" + "));
const limitLabel =(e) => `${e.limit} ${/character/i.test(e.unit || "") ? "characters" : "words"}`;

function ThisWeek({ week, schedule, today }) {
  const next = schedule.groups.filter((g) => g.deadline && g.deadline.date >= today).sort((a, b) => (a.deadline.date < b.deadline.date ? -1 : 1))[0];
  return (
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
    </section>
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
    <section className="cf-tl-section" aria-labelledby="tl-rounds">
      <div className="cf-section-heading"><h2 id="tl-rounds">Pick a round</h2><span>{rows.length} school{rows.length === 1 ? "" : "s"}</span></div>
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
  const title = e.slug ? <a href={schoolHref(e.slug)}>{e.title}</a> : e.title;
  return (
    <li className={cls}>
      <span className="cf-tl-event__date cf-nums"><span>{weekday(e.date)}</span>{TL.shortDate(e.date)}</span>
      <span className="cf-tl-event__body">
        <strong>{title}</strong>
        {e.sub ? <span>{e.sub}</span> : null}
      </span>
      <span className="cf-tl-event__kind">{e.done ? "Submitted" : e.kind === "milestone" && e.mine ? "Your date" : KIND_LABELS[e.kind]}</span>
    </li>
  );
}

function DatesList({ months, today }) {
  const todayRow = <li className="cf-tl-today" key="today"><span className="cf-nums">Today · {weekday(today)} {TL.shortDate(today)}</span></li>;
  return (
    <section className="cf-tl-section" aria-labelledby="tl-dates">
      <div className="cf-section-heading"><h2 id="tl-dates">Dates</h2><a href="#share/calendar">Subscribe in your calendar →</a></div>
      <div className="cf-tl-months">
        {months.map((m) => (
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
    <section className="cf-tl-section" aria-labelledby="tl-writing">
      <div className="cf-section-heading"><h2 id="tl-writing">Writing schedule</h2><span className="cf-nums">{schedule.weeks.length} week{schedule.weeks.length === 1 ? "" : "s"} of writing</span></div>
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

function Timeline({ data, tracker, onWorkspaceChange }) {
  const today = tlToday();
  const apps = (tracker && tracker.apps) || [];
  const dates = React.useMemo(() => TL.timeline(data, apps, today), [data, apps, today]);
  const schedule = React.useMemo(() => window.cfWritingSchedule.writingSchedule(data, apps, today), [data, apps, today]);
  const hasDates = dates.months.some((m) => m.events.length);
  return (
    <div className="cf-page cf-tl">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Timeline</h1>
          <p className="cf-page-lede">Every date from now through spring, and a week-by-week plan that gets each school's essays done before its deadline.</p>
        </div>
      </header>
      {schedule.groups.length ? <ThisWeek week={schedule.thisWeek} schedule={schedule} today={today} /> : null}
      {dates.needsRound.length ? <PickRound rows={dates.needsRound} onWorkspaceChange={onWorkspaceChange} /> : null}
      {hasDates ? <DatesList months={dates.months} today={today} /> : <div className="cf-empty">No dates yet. Add schools to your list and their deadlines will show here.</div>}
      {schedule.groups.length ? <WritingPlan schedule={schedule} today={today} /> : <div className="cf-empty" style={{ marginTop: 24 }}>No essays to plan. Add schools on the shortlist, and their prompts will appear on the Essays tab and here.</div>}
    </div>
  );
}
window.Timeline = Timeline;
