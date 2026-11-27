const { Badge, Button } = window.CollegeForgeDesignSystem_e95e63;

// Waitlisted uses a fixed blue: the theme's teal is too close to the success green.
const RESULT_COLOR = { Accepted: "var(--success)", Denied: "var(--error)", Waitlisted: "#5b7fd6", Deferred: "var(--warning)" };
const RESULT_ORDER = ["Denied", "Deferred", "Waitlisted", "Accepted"];
const colorFor = (result) => RESULT_COLOR[result] || "var(--muted)";

function bookmarkletCode(origin) {
  return "javascript:(function(){if(location.hostname!=='app.maialearning.com'){alert('Open app.maialearning.com, sign in, then click this bookmark.');return;}"
    + "window.__cfMaiaPopup=window.open('" + origin + "/hub/maia-import.html','cf-maia-import','width=520,height=640');"
    + "var s=document.createElement('script');s.src='" + origin + "/maia/import.js?v='+Date.now();document.body.appendChild(s);})();";
}

// First number in a profile field, e.g. "3.9/4.0" → 3.9, "1,500" → 1500.
function toNumber(value) {
  const match = String(value ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

function studentMarker(doc, applicant) {
  const maia = (doc && doc.student) || {};
  const gpa = maia.gpa ?? toNumber(applicant.gpaUnweighted);
  const sat = maia.sat ?? toNumber(applicant.sat);
  const fromMaia = maia.gpa != null && maia.sat != null;
  return gpa != null && gpa <= 5 && sat != null && sat >= 400 && sat <= 1600 ? { gpa, sat, fromMaia } : null;
}

// Draw at the container's real width so labels stay readable on phones.
function useWidth(ref) {
  const [width, setWidth] = React.useState(640);
  React.useEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const diamond = (cx, cy, r) => `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`;
const square = (cx, cy, r) => `M${cx - r} ${cy - r}h${2 * r}v${2 * r}h${-2 * r}Z`;
const triangle = (cx, cy, r) => `M${cx} ${cy - 1.15 * r}L${cx + 1.1 * r} ${cy + 0.8 * r}L${cx - 1.1 * r} ${cy + 0.8 * r}Z`;

// Maia's round labels vary ("Early Decision II", "ED2", "REA", "Restrictive Early Action"), so match loosely.
function roundKind(round) {
  const r = String(round || "").toLowerCase();
  if (/early decision|\bed\s*(i{1,2}|[12])?\b/.test(r)) return "ED";
  if (/early action|\b(r|sc)?ea\b/.test(r)) return "EA";
  return null;
}
// Diamond is taken by the "You" marker; everything that isn't ED or EA stays a circle.
const ROUND_SHAPE = { ED: square, EA: triangle };

function roundSummary(points) {
  return ["ED", "EA"].map((kind) => {
    const round = points.filter((p) => roundKind(p.round) === kind);
    return round.length ? `${kind} ${round.filter((p) => p.result === "Accepted").length} of ${round.length} accepted` : null;
  }).filter(Boolean).join(" · ");
}

function ScatterChart({ college, student }) {
  const boxRef = React.useRef(null);
  const W = useWidth(boxRef);
  const narrow = W < 520;
  const H = Math.round(Math.min(360, Math.max(240, W * 0.55)));
  const pad = { l: 44, r: 12, t: 12, b: 34 };
  const dot = college.n > 200 || narrow ? 3.5 : 5;
  const plotted = college.points.filter((p) => p.sat != null && p.gpa != null);
  const sats = plotted.map((p) => p.sat).concat(student ? [student.sat] : []);
  const gpas = plotted.map((p) => p.gpa).concat(student ? [student.gpa] : []);
  // Fit the axes to the points (with a minimum span) so the plot isn't mostly empty.
  const maxSat = 1600;
  const minSat = Math.min(maxSat - 300, Math.floor((Math.min(...sats) - 20) / 100) * 100);
  const maxGpa = Math.max(4, Math.ceil(Math.max(...gpas, 0) * 4) / 4);
  const minGpa = Math.min(maxGpa - 0.5, Math.floor((Math.min(...gpas) - 0.05) * 4) / 4);
  const x = (s) => pad.l + ((s - minSat) / (maxSat - minSat)) * (W - pad.l - pad.r);
  const y = (g) => pad.t + (1 - (g - minGpa) / (maxGpa - minGpa)) * (H - pad.t - pad.b);
  const satTicks = [];
  for (let s = maxSat; s >= minSat; s -= narrow ? 200 : 100) satTicks.unshift(s);
  const gpaTicks = [];
  for (let g = minGpa; g <= maxGpa + 1e-9; g += 0.25) gpaTicks.push(Math.round(g * 100) / 100);
  const sorted = [...plotted].sort((a, b) => RESULT_ORDER.indexOf(a.result) - RESULT_ORDER.indexOf(b.result));
  const summary = Object.entries(college.counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ");

  return (
    <div ref={boxRef}>
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${college.name}: GPA versus SAT for ${college.n} past applicants from your school (${summary})`} style={{ display: "block", maxWidth: "100%" }}>
      {satTicks.map((s) => <g key={"s" + s}>
        <line x1={x(s)} x2={x(s)} y1={pad.t} y2={H - pad.b} stroke="var(--hairline)" strokeWidth="1" />
        <text x={x(s)} y={H - pad.b + 16} textAnchor="middle" fontSize="11" fill="var(--muted)">{s}</text>
      </g>)}
      {gpaTicks.map((g) => <g key={"g" + g}>
        <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} stroke="var(--hairline)" strokeWidth="1" />
        <text x={pad.l - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{g.toFixed(2)}</text>
      </g>)}
      <text x={(pad.l + W - pad.r) / 2} y={H - 4} textAnchor="middle" fontSize="11" fill="var(--muted)">SAT</text>
      {student && <g stroke="var(--coral)" strokeDasharray="5 4" strokeWidth="1.2">
        <line x1={x(student.sat)} x2={x(student.sat)} y1={pad.t} y2={H - pad.b} />
        <line x1={pad.l} x2={W - pad.r} y1={y(student.gpa)} y2={y(student.gpa)} />
      </g>}
      {sorted.map((p, i) => {
        const shape = ROUND_SHAPE[roundKind(p.round)];
        const title = <title>{`${p.result}${p.round ? " · " + p.round : ""} — SAT ${p.sat}, GPA ${p.gpa.toFixed(2)}`}</title>;
        return shape
          ? <path key={i} d={shape(x(p.sat), y(p.gpa), dot * 0.9)} fill={colorFor(p.result)} fillOpacity="0.8">{title}</path>
          : <circle key={i} cx={x(p.sat)} cy={y(p.gpa)} r={dot} fill={colorFor(p.result)} fillOpacity="0.8">{title}</circle>;
      })}
      {college.averages.sat != null && college.averages.gpa != null && <path d={`M${x(college.averages.sat) - 7} ${y(college.averages.gpa)}h14M${x(college.averages.sat)} ${y(college.averages.gpa) - 7}v14`} stroke="var(--ink)" strokeWidth="1.8"><title>{`Maia average — SAT ${college.averages.sat}, GPA ${college.averages.gpa}`}</title></path>}
      {student && <path d={diamond(x(student.sat), y(student.gpa), 8)} fill="var(--coral)" stroke="var(--canvas)" strokeWidth="2"><title>{`You — SAT ${student.sat}, GPA ${student.gpa}`}</title></path>}
    </svg>
    </div>
  );
}

function Legend({ hasStudent }) {
  const items = [["Accepted", RESULT_COLOR.Accepted], ["Denied", RESULT_COLOR.Denied], ["Waitlisted", RESULT_COLOR.Waitlisted], ["Deferred", RESULT_COLOR.Deferred]];
  const item = { display: "inline-flex", alignItems: "center", gap: 6 };
  return <ul style={{ display: "flex", flexWrap: "wrap", gap: 14, listStyle: "none", padding: 0, margin: "0 0 16px", fontSize: 12, color: "var(--muted)" }}>
    {items.map(([label, color]) => <li key={label} style={item}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 9999, background: color }} />{label}</li>)}
    <li style={item}><svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><path d={square(6, 6, 4.5)} fill="var(--muted)" /></svg>Early Decision</li>
    <li style={item}><svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><path d={triangle(6, 6.5, 4.5)} fill="var(--muted)" /></svg>Early Action</li>
    <li style={item}><svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="var(--muted)" /></svg>Regular / other</li>
    {hasStudent && <li style={item}><svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><path d={diamond(6, 6, 5)} fill="var(--coral)" /></svg>You</li>}
    <li style={item}><span aria-hidden="true" style={{ color: "var(--ink)", fontWeight: 600 }}>+</span>Maia average</li>
  </ul>;
}

function CollegeScatter({ college, student }) {
  const accepted = college.counts.Accepted || 0;
  const unplotted = college.points.filter((p) => p.sat == null || p.gpa == null).length;
  const rounds = roundSummary(college.points);
  return (
    <section style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", padding: 16, background: "var(--canvas)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <h3 className="cf-display" style={{ margin: 0, fontSize: 20, color: "var(--ink)" }}>{college.rank ? <span style={{ color: "var(--muted)", marginRight: 8 }}>{`#${college.rank}`}</span> : null}{college.name}</h3>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          {college.n === 0 ? "No applicants from your school" : `${college.n} applicants · ${accepted} accepted (${Math.round((accepted / college.n) * 100)}%)${rounds ? " · " + rounds : ""}`}
        </span>
      </div>
      {college.n === 0
        ? <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>Maia has no past applicants from your school for this college.</p>
        : <>
          <ScatterChart college={college} student={student} />
          {unplotted > 0 && <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)" }}>{unplotted} applicant{unplotted === 1 ? "" : "s"} without both SAT and GPA aren’t plotted.</p>}
        </>}
    </section>
  );
}

const OTHER_PAGE = 12;
const QUEUE_KEY = "cf.maiaQueue"; // read by maia-import.js on the next bookmark run

function readQueue() {
  try { const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); return Array.isArray(q) ? q : []; } catch { return []; }
}
function writeQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* private mode */ }
}

/** Imported schools that aren't on the student's list: looked up one at a time, or from an older top-N import. */
function OtherScatters({ colleges, student }) {
  const [shown, setShown] = React.useState(OTHER_PAGE);
  if (!colleges.length) return null;
  return (
    <section style={{ marginTop: 32 }}>
      <h2 className="cf-display" style={{ margin: "0 0 4px", fontSize: 26, color: "var(--ink)" }}>Other schools</h2>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)" }}>{`${colleges.length} imported school${colleges.length === 1 ? "" : "s"} not on your list, ranked schools first.`}</p>
      <div style={{ display: "grid", gap: 16 }}>
        {colleges.slice(0, shown).map((c) => <CollegeScatter key={c.slug} college={c} student={student} />)}
      </div>
      {shown < colleges.length && <div style={{ marginTop: 16 }}><Button size="sm" variant="secondary" onClick={() => setShown(shown + OTHER_PAGE)}>{`Show more (${colleges.length - shown} left)`}</Button></div>}
    </section>
  );
}

/**
 * Find any school. One already imported opens its chart here; any other goes on a
 * queue that the next bookmark run imports along with the list.
 */
function LookupSchool({ doc, student, onList }) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState([]);
  const [picked, setPicked] = React.useState(null);
  const [queue, setQueue] = React.useState(readQueue);
  // The popup empties the queue as it imports, so re-read it when the student comes back.
  React.useEffect(() => {
    const sync = () => setQueue(readQueue());
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/colleges/search?q=" + encodeURIComponent(q), { credentials: "same-origin" });
        const j = await res.json();
        if (live) setResults(res.ok && j.success && Array.isArray(j.data) ? j.data.slice(0, 8) : []);
      } catch { if (live) setResults([]); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [query]);

  const queued = new Set(queue.map((c) => c.slug));
  const pick = (c) => { setPicked(c); setQuery(""); setResults([]); };
  const enqueue = (c) => {
    const next = [...queue.filter((q) => q.slug !== c.slug), { slug: c.slug, name: c.name, scorecardId: c.scorecardId || null }].slice(-100);
    writeQueue(next); setQueue(next);
  };
  const dequeue = (slug) => { const next = queue.filter((q) => q.slug !== slug); writeQueue(next); setQueue(next); };
  const pickedData = picked && doc ? doc.colleges[picked.slug] : null;

  return (
    <section style={{ marginBottom: 24 }}>
      <label htmlFor="cf-scatter-q" style={{ display: "block", fontSize: 14, color: "var(--ink)", marginBottom: 6 }}>Look up any school</label>
      <input id="cf-scatter-q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Start typing, like Rice or Pomona" autoComplete="off"
        style={{ boxSizing: "border-box", width: "100%", maxWidth: 480, font: "inherit", fontSize: 14, padding: "8px 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)" }} />
      {results.length > 0 && <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", maxWidth: 480 }}>
        {results.map((c) => <li key={c.slug}><button type="button" onClick={() => pick(c)} style={{ display: "block", width: "100%", textAlign: "left", border: 0, borderBottom: "1px solid var(--hairline)", background: "transparent", padding: "8px 2px", fontSize: 13, color: "var(--ink)", cursor: "pointer" }}>
          {c.name}{c.location ? <span style={{ color: "var(--muted)" }}>{" · " + String(c.location).split(" · ")[0]}</span> : null}
          {doc && doc.colleges[c.slug] ? <span style={{ color: "var(--muted)" }}> · imported</span> : null}
        </button></li>)}
      </ul>}
      {picked && <div style={{ marginTop: 16 }}>
        {pickedData
          ? <CollegeScatter college={pickedData} student={student} />
          : <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, color: "var(--body)" }}>{onList.has(picked.slug)
              ? `${picked.name} is on your list, so the next bookmark run imports it.`
              : queued.has(picked.slug) ? `${picked.name} will be imported the next time you click the bookmark in Maia.` : `${picked.name} isn’t imported yet.`}</span>
            {!onList.has(picked.slug) && !queued.has(picked.slug) && <Button size="sm" onClick={() => enqueue(picked)}>Import on next Maia run</Button>}
          </div>}
      </div>}
      {queue.length > 0 && <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--muted)" }}>
        {"Waiting for the next Maia run: "}
        {queue.map((c, i) => <React.Fragment key={c.slug}>{i > 0 ? ", " : ""}{c.name} <button type="button" aria-label={`Remove ${c.name}`} onClick={() => dequeue(c.slug)} style={{ border: 0, background: "transparent", color: "var(--coral)", cursor: "pointer", padding: 0, fontSize: 13 }}>×</button></React.Fragment>)}
      </p>}
    </section>
  );
}

function ImportSetup({ imported, onDelete, busy }) {
  const linkRef = React.useRef(null);
  const [copied, setCopied] = React.useState(false);
  // Once data is imported, the setup steps only matter for a refresh, so they start collapsed.
  const [open, setOpen] = React.useState(!imported);
  const code = bookmarkletCode(window.location.origin);
  // React warns on javascript: hrefs in JSX, so the bookmarklet link is set directly.
  React.useEffect(() => { if (linkRef.current) linkRef.current.setAttribute("href", code); }, [code]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  };
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", padding: open ? 20 : "12px 20px", background: "var(--surface-soft)", marginBottom: 24 }}>
      <summary style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, cursor: "pointer", listStyle: "none", marginBottom: open ? 8 : 0 }}>
        <h2 className="cf-display" style={{ margin: 0, fontSize: 22, color: "var(--ink)" }}>{imported ? "Refresh from Maia" : "Import from Maia Learning"}</h2>
        <span style={{ fontSize: 13, color: "var(--coral)", whiteSpace: "nowrap" }}>{open ? "Hide ▴" : "Show steps ▾"}</span>
      </summary>
      <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--body)" }}>If your high school uses Maia Learning, you can bring in its scattergrams: where past applicants from your school landed, by GPA and SAT. Every college on your list comes in automatically, and you can look up any other school.</p>
      <ol style={{ margin: "0 0 16px", paddingLeft: 20, fontSize: 14, color: "var(--body)", lineHeight: 1.7 }}>
        <li>Drag this button to your bookmarks bar: <a ref={linkRef} onClick={(e) => e.preventDefault()} style={{ display: "inline-block", padding: "4px 12px", borderRadius: "var(--radius-pill)", background: "var(--coral)", color: "var(--on-primary)", textDecoration: "none", fontWeight: 600, cursor: "grab" }}>Forge ← Maia</a> <button type="button" onClick={copy} style={{ border: "none", background: "transparent", color: "var(--coral)", cursor: "pointer", fontSize: 13 }}>{copied ? "Copied" : "or copy it"}</button></li>
        <li>Open <a href="https://app.maialearning.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--coral)" }}>app.maialearning.com</a> and sign in.</li>
        <li>Click the bookmark. A small College Forge window imports the colleges on your list (plus any you queued below) and saves them here. Clicking it again fetches only schools that are missing or more than two weeks old, so a stopped import picks up where it left off. When it’s done, you can search for any other school in that window.</li>
      </ol>
      <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>This uses your own Maia sign-in in your browser; College Forge never sees your Maia password or session. The data describes real students from your school, so it stays private to your workspace and is left out of share links and exports. Maia doesn’t officially support this, so it may stop working if Maia changes.</p>
      {imported && <div style={{ marginTop: 12 }}><Button size="sm" variant="secondary" disabled={busy} onClick={onDelete}>Delete imported data</Button></div>}
    </details>
  );
}

function Scattergrams({ data }) {
  const [doc, setDoc] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    try { setDoc(await window.cfApi.getScattergrams()); setError(""); }
    catch (e) { setError(e.message || "Couldn’t load scattergrams."); }
    finally { setLoading(false); }
  }, []);
  // The import finishes in a popup, so re-read when the student comes back to this tab.
  React.useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  const remove = async () => {
    if (!window.confirm("Delete all imported Maia scattergram data from this workspace?")) return;
    setBusy(true);
    try { await window.cfApi.deleteScattergrams(); setDoc(null); }
    catch (e) { setError(e.message || "Delete failed."); }
    finally { setBusy(false); }
  };

  const student = studentMarker(doc, data.applicant || {});
  const imported = doc ? data.colleges.map((c) => doc.colleges[c.slug]).filter(Boolean) : [];
  const notImported = doc ? data.colleges.filter((c) => !doc.colleges[c.slug]) : [];
  const onList = new Set(data.colleges.map((c) => c.slug));
  const others = doc ? Object.values(doc.colleges).filter((c) => !onList.has(c.slug)).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.name.localeCompare(b.name)) : [];

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Scattergrams</h1>
          <p className="cf-page-lede">Where past applicants from your high school landed, by GPA and SAT: every college on your list, and any other school you look up.</p>
        </div>
        {doc && <Badge variant="cream" uppercase>{`Imported ${new Date(doc.importedAt).toLocaleDateString()}${doc.classOfYears ? ` · last ${doc.classOfYears} classes` : ""}`}</Badge>}
      </header>
      {error && <p role="alert" style={{ color: "var(--error)", fontSize: 14 }}>{error}</p>}
      {!loading && <ImportSetup key={doc ? "refresh" : "import"} imported={Boolean(doc)} onDelete={remove} busy={busy} />}
      {!loading && <LookupSchool doc={doc} student={student} onList={onList} />}
      {loading ? <p style={{ color: "var(--muted)", fontSize: 14 }}>Loading…</p>
        : !doc ? null
        : <>
          <Legend hasStudent={Boolean(student)} />
          {student && <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)" }}>{`You: SAT ${student.sat}, unweighted GPA ${student.gpa}${student.fromMaia ? " (from Maia)" : " (from your profile)"}. Your school's history is a rough guide, not a prediction.`}</p>}
          <div style={{ display: "grid", gap: 16 }}>
            {imported.map((c) => <CollegeScatter key={c.slug} college={c} student={student} />)}
          </div>
          {notImported.length > 0 && <p style={{ marginTop: 16, fontSize: 13, color: "var(--muted)" }}>{`Not imported yet: ${notImported.map((c) => c.short || c.name).join(", ")}. Click the bookmark in Maia again to add them.`}</p>}
          <OtherScatters colleges={others} student={student} />
        </>}
    </div>
  );
}
window.Scattergrams = Scattergrams;
// A school's detail page (SchoolDetail.jsx) draws its scattergram with the same chart.
window.cfScatter = { CollegeScatter, studentMarker };
