// Shared pieces for the Applications and Decisions tabs.

const APP_STATUSES = [
  { id: "planning", label: "Not started", stage: "working", tone: "var(--muted-soft)" },
  { id: "in_progress", label: "In progress", stage: "working", tone: "var(--accent-amber)" },
  { id: "submitted", label: "Submitted", stage: "waiting", tone: "var(--coral)" },
  { id: "complete", label: "Under review", stage: "waiting", tone: "var(--accent-teal)" },
  { id: "deferred", label: "Deferred", stage: "waiting", tone: "var(--accent-amber)" },
  { id: "waitlisted", label: "Waitlisted", stage: "waiting", tone: "var(--accent-amber)" },
  { id: "admitted", label: "Admitted", stage: "admitted", tone: "var(--success)" },
  { id: "committed", label: "Committed", stage: "admitted", tone: "var(--success)" },
  { id: "denied", label: "Denied", stage: "denied", tone: "var(--error)" },
  { id: "withdrawn", label: "Withdrawn", stage: "closed", tone: "var(--muted-soft)" },
];
const APP_STAGES = [
  { id: "working", label: "Working on" },
  { id: "waiting", label: "Waiting to hear" },
  { id: "admitted", label: "Admitted" },
  { id: "denied", label: "Not admitted" },
  { id: "closed", label: "Withdrawn" },
];
const APP_ROUNDS = [
  { id: "", label: "Not set" },
  { id: "ED", label: "Early Decision" },
  { id: "ED2", label: "Early Decision II" },
  { id: "EA", label: "Early Action" },
  { id: "REA", label: "Restrictive Early Action" },
  { id: "RD", label: "Regular Decision" },
  { id: "Rolling", label: "Rolling" },
];

const statusMeta = (id) => APP_STATUSES.find((s) => s.id === id) || APP_STATUSES[0];

function todayIso() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

function fmtDate(iso, opts) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear && !(opts && opts.year) ? {} : { year: "numeric" }) });
}

function daysUntil(iso) {
  if (!iso) return null;
  return Math.round((new Date(iso + "T12:00:00") - new Date(todayIso() + "T12:00:00")) / 86400000);
}

function relDays(iso) {
  const n = daysUntil(iso);
  if (n === null) return "";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

function ago(ts) {
  if (!ts) return "";
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function initials(name) {
  return String(name || "?").replace(/\b(of|the|at|and|in)\b/gi, " ").split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w[0]).join("").toUpperCase();
}

function SchoolMark({ name, logo }) {
  const [broken, setBroken] = React.useState(false);
  return (
    <span className="cf-school-mark" aria-hidden="true">
      {logo && !broken ? <img src={logo} alt="" loading="lazy" onError={() => setBroken(true)} /> : <span style={{ color: "var(--muted)" }}>{initials(name)}</span>}
    </span>
  );
}

function StatusSelect({ app, disabled, onChange, label }) {
  const meta = statusMeta(app.status);
  return (
    <span className="cf-status" style={{ "--tone": meta.tone }}>
      <select aria-label={label || `Status for ${app.name}`} value={app.status} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {APP_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    </span>
  );
}

function Chevron() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m2 4 4 4 4-4" /></svg>;
}

window.cfApp = { APP_STATUSES, APP_STAGES, APP_ROUNDS, statusMeta, todayIso, fmtDate, daysUntil, relDays, ago, SchoolMark, StatusSelect, Chevron };
