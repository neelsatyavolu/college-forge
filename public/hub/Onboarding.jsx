// Unique names — hub Babel scripts share one global scope, so plain `Field` /
// `Input` would be clobbered by Profile.jsx (read-only Field + local Input).
const {
  Button: OnboardButton,
  Input: OnboardInput,
  Badge: OnboardBadge,
} = window.CollegeForgeDesignSystem_e95e63;

// welcome → AI → You → Academics → Story → List prefs → Upload → Build
const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "connect", label: "AI" },
  { id: "identity", label: "You" },
  { id: "academics", label: "Academics" },
  { id: "story", label: "Story" },
  { id: "prefs", label: "List" },
  { id: "upload", label: "Upload" },
  { id: "build", label: "Build" },
];

const AMBITION_OPTIONS = [
  {
    id: "ambitious",
    title: "Ambitious",
    blurb: "More reaches. Stretch for dream schools; fewer safeties.",
  },
  {
    id: "balanced",
    title: "Just right",
    blurb: "Classic mix of reaches, targets, and safeties.",
  },
  {
    id: "conservative",
    title: "Conservative",
    blurb: "Favor likelier admits; fewer ultra-selective reaches.",
  },
];

const SETTING_OPTIONS = [
  { id: "urban", label: "Urban" },
  { id: "suburban", label: "Suburban" },
  { id: "rural", label: "Rural" },
  { id: "college-town", label: "College town" },
];

const SIZE_OPTIONS = [
  { id: "any", label: "Any size" },
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
];

const REGION_OPTIONS = [
  { id: "northeast", label: "Northeast" },
  { id: "mid-atlantic", label: "Mid-Atlantic" },
  { id: "south", label: "South" },
  { id: "midwest", label: "Midwest" },
  { id: "west", label: "West" },
  { id: "any", label: "Anywhere" },
];

function present(v) {
  const s = String(v ?? "").trim();
  return Boolean(s) && s !== "—";
}

function countLines(text) {
  return String(text || "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean).length;
}

function loadAiPrefs() {
  try {
    return JSON.parse(localStorage.getItem("cf.ai") || "{}") || {};
  } catch (e) {
    return {};
  }
}

function OnboardFieldLabel({ children, hint, required }) {
  return (
    <label style={{ display: "block", marginBottom: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", letterSpacing: "0.2px" }}>
        {children}
        {required ? <span style={{ color: "var(--coral)", marginLeft: 4 }}>*</span> : null}
      </span>
      {hint ? (
        <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2, fontWeight: 400 }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function OnboardField({ label, hint, required, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <OnboardFieldLabel required={required} hint={hint}>{label}</OnboardFieldLabel>
      {children}
    </div>
  );
}

function OnboardTextarea({ value, onChange, placeholder, rows = 6, style = {} }) {
  return (
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      className="cf-onboard-textarea"
      style={style}
    />
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={"cf-onboard-chip" + (active ? " is-active" : "")}
    >
      {children}
    </button>
  );
}

function ChoiceCard({ active, title, blurb, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={"cf-onboard-choice" + (active ? " is-active" : "")}
    >
      <span className="cf-onboard-choice__title">{title}</span>
      <span className="cf-onboard-choice__blurb">{blurb}</span>
    </button>
  );
}

function Progress({ step }) {
  return (
    <nav aria-label="Onboarding progress" className="cf-onboard-progress">
      {STEPS.map((s, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={s.id} className={"cf-onboard-progress__item" + (active ? " is-active" : "") + (done ? " is-done" : "")}>
            <span className="cf-onboard-progress__dot" aria-hidden>{done ? "✓" : i + 1}</span>
            <span className="cf-onboard-progress__label">{s.label}</span>
          </div>
        );
      })}
    </nav>
  );
}

// ── Connect ──────────────────────────────────────────────────────────────
function ConnectStep({ status, onConnected }) {
  const [flow, setFlow] = React.useState(null);
  const [authUrl, setAuthUrl] = React.useState("");
  const [callback, setCallback] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  const connected = status && status.active;
  const activeLabel =
    connected
      ? status.active === "grok"
        ? "Grok"
        : status.active === "codex"
          ? "ChatGPT"
          : "AI"
      : null;

  const start = async (provider) => {
    setErr("");
    setBusy(true);
    setFlow(provider);
    setCallback("");
    try {
      const res = await fetch(`/api/auth/${provider}/start`, {
        method: "POST",
        credentials: "same-origin",
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not start sign-in.");
      setAuthUrl(j.authorizeUrl);
      window.open(j.authorizeUrl, "_blank", "noopener");
    } catch (e) {
      setErr(e.message);
      setFlow(null);
    }
    setBusy(false);
  };

  const complete = async () => {
    if (!callback.trim() || !flow) return;
    setErr("");
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${flow}/complete`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callback: callback.trim() }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Sign-in failed.");
      setFlow(null);
      setAuthUrl("");
      setCallback("");
      await onConnected();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  if (connected) {
    return (
      <div className="cf-onboard-card cf-onboard-success">
        <div style={{ fontSize: 28, marginBottom: 8 }} aria-hidden>✓</div>
        <h2 className="cf-display" style={{ margin: "0 0 8px", fontSize: 24, color: "var(--ink)" }}>
          {activeLabel} connected
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: "var(--body)", lineHeight: 1.55 }}>
          The copilot will use your {activeLabel} account to build your hub at the end.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="cf-display" style={{ margin: "0 0 8px", fontSize: 26, color: "var(--ink)" }}>
        Connect an AI provider
      </h2>
      <p style={{ margin: "0 0 20px", fontSize: 14, color: "var(--body)", lineHeight: 1.6, maxWidth: 520 }}>
        College Forge runs on <strong style={{ color: "var(--ink)" }}>your own</strong> Grok (xAI) or ChatGPT account.
        You’ll need one so we can structure your profile and draft a college list.
      </p>

      {!flow ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 360 }}>
          <OnboardButton size="md" onClick={() => start("grok")} disabled={busy} style={{ justifyContent: "center" }}>
            Connect Grok
          </OnboardButton>
          <OnboardButton size="md" variant="secondary" onClick={() => start("codex")} disabled={busy} style={{ justifyContent: "center" }}>
            Connect ChatGPT
          </OnboardButton>
        </div>
      ) : (
        <div className="cf-onboard-card" style={{ maxWidth: 480 }}>
          <div style={{ fontSize: 13, color: "var(--body)", lineHeight: 1.55, marginBottom: 12 }}>
            Authorizing <strong style={{ color: "var(--ink)" }}>{flow === "grok" ? "Grok" : "ChatGPT"}</strong> in a new tab
            {authUrl ? (
              <>
                {" "}
                (<a href={authUrl} target="_blank" rel="noopener noreferrer">reopen</a>)
              </>
            ) : null}
            :
            <ol style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              <li>Approve the request.</li>
              <li>
                You’ll land on a <strong style={{ color: "var(--ink)" }}>page that fails to load</strong> (localhost). That’s expected.
              </li>
              <li>Copy that page’s full URL and paste it below.</li>
            </ol>
          </div>
          <OnboardInput
            value={callback}
            onChange={(e) => setCallback(e.target.value)}
            placeholder="Paste the localhost URL from the address bar…"
          />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <OnboardButton size="sm" onClick={complete} disabled={busy || !callback.trim()}>
              Finish sign-in
            </OnboardButton>
            <OnboardButton size="sm" variant="secondary" onClick={() => { setFlow(null); setErr(""); }} disabled={busy}>
              Cancel
            </OnboardButton>
          </div>
        </div>
      )}
      {err ? <p style={{ margin: "14px 0 0", color: "var(--error)", fontSize: 13 }}>{err}</p> : null}
    </div>
  );
}

// ── Story: activities, awards, other ─────────────────────────────────────
function StoryStep({ story, onChange }) {
  const set = (key) => (e) => onChange({ ...story, [key]: e.target.value });
  const actLines = countLines(story.activities);
  const awardLines = countLines(story.awards);

  return (
    <div>
      <h2 className="cf-display" style={{ margin: "0 0 8px", fontSize: 26, color: "var(--ink)" }}>
        Your story
      </h2>
      <p style={{ margin: "0 0 10px", fontSize: 14, color: "var(--body)", lineHeight: 1.65, maxWidth: 560 }}>
        This is the fuel for your hub. Dump <strong style={{ color: "var(--ink)" }}>as much as you want</strong> —
        activities, clubs, sports, jobs, research, volunteering, family responsibilities, summer programs,
        awards, and anything that makes you you. Messy bullets are fine; the AI will organize them.
      </p>
      <div className="cf-onboard-nudge" role="note">
        More detail → a stronger profile and a smarter college list. Don’t self-edit yet.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 560, marginTop: 18 }}>
        <OnboardField
          label="Activities & extracurriculars"
          hint="One activity per line. Role, hours/week, years, impact if you know them."
        >
          <OnboardTextarea
            value={story.activities}
            onChange={set("activities")}
            rows={8}
            placeholder={"Examples:\n• Debate captain — 8 hrs/wk, 3 yrs — led team to state semis\n• Robotics lead programmer — 10 hrs/wk — built vision stack for FTC\n• Weekend barista — 12 hrs/wk — managed opening shifts"}
          />
          <div className="cf-onboard-meta">
            {actLines ? `${actLines} line${actLines === 1 ? "" : "s"}` : "Empty — add a few if you can"}
            {story.activities.trim().length ? ` · ${story.activities.trim().length.toLocaleString()} chars` : ""}
          </div>
        </OnboardField>

        <OnboardField
          label="Awards & honors"
          hint="School, state, national — academic, arts, sports, community."
        >
          <OnboardTextarea
            value={story.awards}
            onChange={set("awards")}
            rows={5}
            placeholder={"Examples:\n• National Merit Semifinalist (2026)\n• AP Scholar with Distinction\n• Regional science fair — 1st, engineering"}
          />
          <div className="cf-onboard-meta">
            {awardLines ? `${awardLines} line${awardLines === 1 ? "" : "s"}` : "Optional but helpful"}
          </div>
        </OnboardField>

        <OnboardField
          label="Anything else"
          hint="Course load, constraints, family context, intended major story, test plans, goals…"
        >
          <OnboardTextarea
            value={story.other}
            onChange={set("other")}
            rows={5}
            placeholder={"e.g. First-gen, need strong financial aid, love small seminars, planning CS + entrepreneurship…"}
          />
        </OnboardField>
      </div>
    </div>
  );
}

// ── Must-have schools (optional seeds for the AI list) ───────────────────
function MustHaveSchools({ selected, onChange, max = 8 }) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState([]);
  const [searching, setSearching] = React.useState(false);
  const [error, setError] = React.useState("");
  const [busySlug, setBusySlug] = React.useState(null);

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/colleges/search?q=${encodeURIComponent(term)}`, {
          credentials: "same-origin",
        });
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok || !j.success) throw new Error(j.error || "Search failed.");
        setResults(j.data || []);
        setError("");
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
          setResults([]);
        }
      }
      if (!cancelled) setSearching(false);
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const slugs = new Set(selected.map((c) => c.slug));

  const add = async (c) => {
    if (slugs.has(c.slug) || selected.length >= max) return;
    setBusySlug(c.slug);
    setError("");
    try {
      const { onList, programs, ...college } = c;
      const res = await fetch("/api/workspace/colleges", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ college: { ...college, priority: true } }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Could not add.");
      const list = (j.data && j.data.colleges) || [];
      const added = list.find((x) => x.slug === c.slug) || { ...college, priority: true };
      const next = [...selected.filter((s) => s.slug !== added.slug), added].slice(0, max);
      onChange(next);
      setQ("");
      setResults([]);
    } catch (e) {
      setError(e.message);
    }
    setBusySlug(null);
  };

  const remove = async (c) => {
    setBusySlug(c.slug);
    setError("");
    try {
      const res = await fetch(`/api/workspace/colleges?slug=${encodeURIComponent(c.slug)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Could not remove.");
      onChange(selected.filter((s) => s.slug !== c.slug));
    } catch (e) {
      setError(e.message);
    }
    setBusySlug(null);
  };

  return (
    <div>
      <OnboardFieldLabel hint="Optional. The AI will keep these and fill around them.">
        Must-include schools
      </OnboardFieldLabel>

      {selected.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {selected.map((c) => (
            <div key={c.slug} className="cf-onboard-school-row">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{c.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  {[c.location, c.admit ? `${c.admit} admit` : null].filter(Boolean).join(" · ")}
                </div>
              </div>
              <OnboardButton size="sm" variant="secondary" onClick={() => remove(c)} disabled={busySlug === c.slug}>
                Remove
              </OnboardButton>
            </div>
          ))}
        </div>
      ) : null}

      {selected.length < max ? (
        <div>
          <OnboardInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search any U.S. college…"
            autoComplete="off"
          />
          {searching ? <div className="cf-onboard-meta" style={{ marginTop: 8 }}>Searching…</div> : null}
          {results.length > 0 ? (
            <ul className="cf-onboard-school-results">
              {results.slice(0, 10).map((c) => {
                const onList = slugs.has(c.slug);
                return (
                  <li key={c.slug}>
                    <button
                      type="button"
                      disabled={onList || busySlug === c.slug || selected.length >= max}
                      onClick={() => add(c)}
                      className="cf-onboard-school-hit"
                    >
                      <span style={{ fontWeight: 600, color: "var(--ink)" }}>{c.name}</span>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>
                        {onList ? "Added" : [c.location, c.admit].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : q.trim().length >= 2 && !searching ? (
            <div className="cf-onboard-meta" style={{ marginTop: 8 }}>No schools found.</div>
          ) : null}
        </div>
      ) : (
        <p className="cf-onboard-meta" style={{ margin: "8px 0 0" }}>
          Max {max} must-includes — the AI will still expand the full list.
        </p>
      )}
      {error ? <p style={{ margin: "10px 0 0", color: "var(--error)", fontSize: 13 }}>{error}</p> : null}
    </div>
  );
}

// ── List preferences ─────────────────────────────────────────────────────
function PrefsStep({ prefs, onChange, mustHave, onMustHaveChange }) {
  const toggleIn = (key, id) => {
    const cur = prefs[key] || [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    onChange({ ...prefs, [key]: next });
  };

  return (
    <div>
      <h2 className="cf-display" style={{ margin: "0 0 8px", fontSize: 26, color: "var(--ink)" }}>
        College list preferences
      </h2>
      <p style={{ margin: "0 0 18px", fontSize: 14, color: "var(--body)", lineHeight: 1.6, maxWidth: 560 }}>
        Tune how aggressive the preliminary list should be and what kind of campuses you want.
        You’ll review everything after the AI builds the hub.
      </p>

      <section style={{ marginBottom: 22 }}>
        <div className="cf-onboard-section-label">Strategy</div>
        <div className="cf-onboard-choice-grid">
          {AMBITION_OPTIONS.map((o) => (
            <ChoiceCard
              key={o.id}
              active={prefs.ambition === o.id}
              title={o.title}
              blurb={o.blurb}
              onClick={() => onChange({ ...prefs, ambition: o.id })}
            />
          ))}
        </div>
      </section>

      <section style={{ marginBottom: 22 }}>
        <div className="cf-onboard-section-label">Campus setting</div>
        <div className="cf-onboard-chip-row">
          {SETTING_OPTIONS.map((o) => (
            <Chip
              key={o.id}
              active={(prefs.settings || []).includes(o.id)}
              onClick={() => toggleIn("settings", o.id)}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: 22 }}>
        <div className="cf-onboard-section-label">School size</div>
        <div className="cf-onboard-chip-row">
          {SIZE_OPTIONS.map((o) => (
            <Chip
              key={o.id}
              active={(prefs.size || "any") === o.id}
              onClick={() => onChange({ ...prefs, size: o.id })}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: 22 }}>
        <div className="cf-onboard-section-label">Regions</div>
        <div className="cf-onboard-chip-row">
          {REGION_OPTIONS.map((o) => (
            <Chip
              key={o.id}
              active={(prefs.regions || []).includes(o.id)}
              onClick={() => {
                if (o.id === "any") {
                  onChange({ ...prefs, regions: ["any"] });
                  return;
                }
                const withoutAny = (prefs.regions || []).filter((r) => r !== "any");
                const next = withoutAny.includes(o.id)
                  ? withoutAny.filter((r) => r !== o.id)
                  : [...withoutAny, o.id];
                onChange({ ...prefs, regions: next });
              }}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: 22, maxWidth: 560 }}>
        <MustHaveSchools selected={mustHave} onChange={onMustHaveChange} max={8} />
      </section>

      <section style={{ maxWidth: 560 }}>
        <OnboardField
          label="Other list constraints"
          hint="Majors, cost, distance from home, religious affiliation, public-only, etc."
        >
          <OnboardTextarea
            value={prefs.notes || ""}
            onChange={(e) => onChange({ ...prefs, notes: e.target.value })}
            rows={4}
            placeholder="e.g. Strong CS or engineering · Prefer schools with need-based aid · Stay within 6 hours of home"
          />
        </OnboardField>
      </section>
    </div>
  );
}

// ── Upload ───────────────────────────────────────────────────────────────
function UploadStep({ uploads, onUploaded }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const fileRef = React.useRef(null);

  const upload = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    setError("");
    setBusy(true);
    try {
      const fd = new FormData();
      for (const f of fileList) fd.append("files", f);
      const res = await fetch("/api/upload", { method: "POST", body: fd, credentials: "same-origin" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Upload failed.");
      onUploaded(j.saved || []);
      if (j.errors && j.errors.length) setError(j.errors.join(" · "));
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div>
      <h2 className="cf-display" style={{ margin: "0 0 8px", fontSize: 26, color: "var(--ink)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span>Upload documents</span>
        <OnboardBadge variant="cream" uppercase>Optional</OnboardBadge>
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--body)", lineHeight: 1.6, maxWidth: 520 }}>
        Transcript, resume, or activities list. The AI will read these when it builds your hub. You can skip.
      </p>
      <div className="cf-onboard-card" style={{ maxWidth: 480 }}>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,.csv,.json"
          style={{ display: "none" }}
          onChange={(e) => upload(e.target.files)}
        />
        <OnboardButton size="md" variant="secondary" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>
          {busy ? "Uploading…" : "Choose files"}
        </OnboardButton>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--muted)" }}>PDF, DOCX, or text · max 15 MB each</p>
        {uploads.length > 0 ? (
          <ul style={{ margin: "14px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {uploads.map((u) => (
              <li key={u.name} style={{ fontSize: 13, color: "var(--ink)" }}>
                ✓ {u.name}
                {u.chars ? <span style={{ color: "var(--muted)" }}> · {u.chars.toLocaleString()} chars</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {error ? <p style={{ margin: "10px 0 0", color: "var(--error)", fontSize: 13 }}>{error}</p> : null}
      </div>
    </div>
  );
}

function ambitionLabel(id) {
  return (AMBITION_OPTIONS.find((o) => o.id === id) || {}).title || id || "Just right";
}

// ── Build / review ───────────────────────────────────────────────────────
function BuildStep({
  draft,
  story,
  prefs,
  mustHave,
  uploads,
  providerLabel,
  buildStatus,
  buildLog,
}) {
  const row = (label, value) => (
    <div className="cf-onboard-review-row">
      <span>{label}</span>
      <span>{present(value) ? value : "—"}</span>
    </div>
  );

  const actN = countLines(story.activities);
  const awardN = countLines(story.awards);
  const storyBits = [
    story.activities.trim() ? `${actN} activity line${actN === 1 ? "" : "s"}` : null,
    story.awards.trim() ? `${awardN} award line${awardN === 1 ? "" : "s"}` : null,
    story.other.trim() ? "extra notes" : null,
  ].filter(Boolean);

  if (buildStatus === "building" || buildStatus === "done") {
    return (
      <div>
        <h2 className="cf-display" style={{ margin: "0 0 8px", fontSize: 26, color: "var(--ink)" }}>
          {buildStatus === "done" ? "Your hub is ready" : "Building your hub…"}
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--body)", lineHeight: 1.6, maxWidth: 520 }}>
          {buildStatus === "done"
            ? "Profile, activities, and a preliminary college list are in place. You can refine anything with the copilot."
            : "Sending your story and preferences to the AI. This usually takes a minute."}
        </p>
        <div className="cf-onboard-card cf-onboard-build-panel">
          <div className="cf-onboard-build-status">
            {buildStatus === "building" ? (
              <span className="cf-onboard-spinner" aria-hidden />
            ) : (
              <span style={{ color: "var(--success)", fontSize: 18 }} aria-hidden>✓</span>
            )}
            <span>{buildLog || (buildStatus === "done" ? "Done" : "Working…")}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="cf-display" style={{ margin: "0 0 8px", fontSize: 26, color: "var(--ink)" }}>
        Review & build
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--body)", lineHeight: 1.6, maxWidth: 560 }}>
        Confirm the snapshot below, then send everything to {providerLabel || "your AI"}.
        It will structure your profile and draft a preliminary college list from your prefs.
      </p>
      <div className="cf-onboard-card" style={{ maxWidth: 520 }}>
        {row("AI", providerLabel || "Connected")}
        {row("Name", draft.name)}
        {row("Grad year", draft.gradYear)}
        {row("High school", draft.hs)}
        {row("Intended major", draft.intended)}
        {row("Location", draft.location)}
        {row("GPA (W)", draft.gpaWeighted)}
        {row("GPA (UW)", draft.gpaUnweighted)}
        {row("SAT", draft.testOptional ? "Test optional" : draft.sat)}
        {row("Story", storyBits.length ? storyBits.join(" · ") : "None yet (AI can still help)")}
        {row("List strategy", ambitionLabel(prefs.ambition))}
        {row(
          "Settings",
          (prefs.settings || []).length
            ? prefs.settings.map((s) => s.replace("-", " ")).join(", ")
            : "Any"
        )}
        {row("Size", prefs.size || "any")}
        {row(
          "Regions",
          (prefs.regions || []).length ? prefs.regions.join(", ") : "Any"
        )}
        {row(
          "Must-include",
          mustHave.length ? mustHave.map((c) => c.short || c.name).join(", ") : "None"
        )}
        {row("List notes", prefs.notes)}
        {row("Uploads", uploads.length ? uploads.map((u) => u.name).join(", ") : "None")}
      </div>
    </div>
  );
}

function buildAiPrompt({ draft, story, prefs, mustHave, uploads }) {
  const satLine = draft.testOptional
    ? "Test optional — not reporting SAT/ACT"
    : `SAT=${draft.sat || "—"} (${draft.satNote || "no section note"})`;

  const must = mustHave.length
    ? mustHave.map((c) => `- ${c.name}${c.slug ? ` [${c.slug}]` : ""}${c.location ? ` — ${c.location}` : ""}`).join("\n")
    : "(none marked as must-include)";

  const uploadLine = uploads.length
    ? uploads.map((u) => `- ${u.name}`).join("\n")
    : "(none)";

  return `You are completing onboarding for this student. Use your tools to WRITE to the hub — do not only describe what you would do.

## Structured identity (authoritative — save with set_applicant_snapshot + set_profile_identity + set_testing)
- Name: ${draft.name.trim()}
- Grad year: ${draft.gradYear.trim() || "—"}
- Cycle: ${draft.cycle.trim() || (draft.gradYear.trim() ? `Fall ${draft.gradYear.trim()}` : "—")}
- High school: ${draft.hs.trim()}
- Location: ${draft.location.trim() || "—"}
- Intended major: ${draft.intended.trim()}
- GPA weighted: ${draft.gpaWeighted.trim() || "—"}
- GPA unweighted: ${draft.gpaUnweighted.trim() || "—"}
- ${satLine}

## Freeform activities & extracurriculars (parse into set_activities, Common App order, rank 1…)
${story.activities.trim() || "(none provided — leave activities empty or infer lightly from uploads only)"}

## Freeform awards & honors (parse into set_honors; set awards count on snapshot)
${story.awards.trim() || "(none provided)"}

## Other student notes
${story.other.trim() || "(none)"}

## College list preferences
- Strategy: ${prefs.ambition} (${ambitionLabel(prefs.ambition)})
  · ambitious = more reaches; balanced = classic mix; conservative = favor likelier admits
- Campus settings: ${(prefs.settings || []).join(", ") || "any"}
- Size: ${prefs.size || "any"}
- Regions: ${(prefs.regions || []).join(", ") || "any"}
- Extra constraints: ${prefs.notes.trim() || "(none)"}

## Must-include schools (already on the workspace or listed — keep them, mark priority when possible)
${must}

## Uploads to read with read_upload if relevant
${uploadLine}

## Required tasks (do all)
1. set_applicant_snapshot + set_profile_identity + set_testing from the structured fields.
2. Parse activities → set_activities (rank by importance; include role, hours, years, desc when present).
3. Parse awards → set_honors; set awards count on the snapshot.
4. Read uploads and merge any extra structured data (coursework, more activities, etc.).
5. Build a preliminary college list of about 8–12 schools matching prefs and the student profile.
   - Always keep must-include schools.
   - Mix reach / target / safety according to ambition.
   - Use web_search + upsert_college with real admit rates, SAT ranges, location, deadlines when possible.
   - Prefer majors and constraints from intended major + list notes.
6. Set a few critical_dates if you know real deadlines for the list.
7. Reply with a short plain-text summary: what you saved + the school list with tiers.

Call tools. Empty fields are better than invented numbers.`;
}

// ── Main wizard ──────────────────────────────────────────────────────────
function Onboarding({ data, onComplete }) {
  const [step, setStep] = React.useState(0);
  const [provider, setProvider] = React.useState(null);
  const [mustHave, setMustHave] = React.useState(() => {
    const cols = (data && data.colleges) || [];
    const priority = cols.filter((c) => c.priority);
    // Prefer explicitly marked must-haves; otherwise seed from any existing list.
    return priority.length ? priority : cols.slice(0, 5);
  });
  const [uploads, setUploads] = React.useState(() => (data && data.uploads) || []);
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [buildStatus, setBuildStatus] = React.useState("idle"); // idle | building | done
  const [buildLog, setBuildLog] = React.useState("");

  const a = (data && data.applicant) || {};
  const p = (data && data.profile) || {};
  const existingStory = (data && data.onboarding && data.onboarding.storyNotes) || {};
  const existingPrefs = (data && data.onboarding && data.onboarding.listPrefs) || {};

  const [draft, setDraft] = React.useState({
    name: a.name || "",
    gradYear: p.gradYear != null && p.gradYear !== "" ? String(p.gradYear) : "",
    cycle: a.cycle || "",
    hs: p.hs || "",
    location: p.location || "",
    intended: p.intended || "",
    gpaWeighted: present(a.gpaWeighted) ? a.gpaWeighted : "",
    gpaUnweighted: present(a.gpaUnweighted) ? a.gpaUnweighted : "",
    sat: present(a.sat) ? a.sat : present(p.testing && p.testing.sat) ? p.testing.sat : "",
    satNote: a.satNote || (p.testing && p.testing.satNote) || "",
    testOptional: false,
  });

  const [story, setStory] = React.useState({
    activities: existingStory.activities || "",
    awards: existingStory.awards || "",
    other: existingStory.other || "",
  });

  const [prefs, setPrefs] = React.useState({
    ambition: existingPrefs.ambition || "balanced",
    settings: existingPrefs.settings || [],
    size: existingPrefs.size || "any",
    regions: existingPrefs.regions || [],
    notes: existingPrefs.notes || "",
  });

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  const loadStatus = React.useCallback(async () => {
    try {
      const res = await fetch("/api/ai/status", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return null;
      const j = await res.json();
      setProvider(j);
      return j;
    } catch (e) {
      return null;
    }
  }, []);

  React.useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  React.useEffect(() => {
    if (data && data.uploads && data.uploads.length) setUploads(data.uploads);
  }, [data]);

  const connected = provider && provider.active;
  const providerLabel = connected
    ? provider.active === "grok"
      ? "Grok"
      : provider.active === "codex"
        ? "ChatGPT"
        : "AI"
    : null;

  const identityOk =
    draft.name.trim() &&
    draft.hs.trim() &&
    draft.intended.trim() &&
    (draft.gradYear.trim() || draft.cycle.trim());
  const academicsOk = present(draft.gpaWeighted) || present(draft.gpaUnweighted);

  const canNext = () => {
    const id = STEPS[step].id;
    if (id === "welcome") return true;
    if (id === "connect") return Boolean(connected);
    if (id === "identity") return Boolean(identityOk);
    if (id === "academics") return Boolean(academicsOk);
    if (id === "story") return true;
    if (id === "prefs") return true;
    if (id === "upload") return true;
    if (id === "build") return Boolean(connected) && identityOk && academicsOk;
    return false;
  };

  const stepError = () => {
    const id = STEPS[step].id;
    if (id === "connect" && !connected) return "Connect Grok or ChatGPT to continue.";
    if (id === "identity" && !identityOk) return "Name, high school, intended major, and grad year are required.";
    if (id === "academics" && !academicsOk) return "Enter at least one GPA (weighted or unweighted).";
    if (id === "build" && !connected) return "AI connection required to build the hub.";
    return "";
  };

  const goNext = () => {
    const msg = stepError();
    if (msg) {
      setErr(msg);
      return;
    }
    setErr("");
    if (step < STEPS.length - 1) setStep((s) => s + 1);
  };

  const goBack = () => {
    if (buildStatus === "building") return;
    setErr("");
    if (step > 0) setStep((s) => s - 1);
  };

  const finish = async () => {
    if (!canNext()) {
      setErr(stepError() || "Fill required fields first.");
      return;
    }
    const fresh = await loadStatus();
    if (!fresh || !fresh.active) {
      setErr("AI connection lost. Go back to Connect and sign in again.");
      setStep(1);
      return;
    }
    if (!identityOk || !academicsOk) {
      setErr("Some required fields are missing. Go back and complete them.");
      return;
    }

    setBusy(true);
    setErr("");
    setBuildStatus("building");
    setBuildLog("Saving your answers…");

    try {
      const sat = draft.testOptional ? "—" : draft.sat.trim() || "—";
      const satNote = draft.testOptional ? "Test optional" : draft.satNote.trim();

      const saveRes = await fetch("/api/workspace", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "complete-onboarding",
          applicant: {
            name: draft.name.trim(),
            cycle: draft.cycle.trim() || (draft.gradYear.trim() ? `Fall ${draft.gradYear.trim()}` : ""),
            year: draft.gradYear.trim() ? `Class of ${draft.gradYear.trim()}` : "",
            gpaWeighted: draft.gpaWeighted.trim() || "—",
            gpaUnweighted: draft.gpaUnweighted.trim() || "—",
            sat,
            satNote,
          },
          profile: {
            intended: draft.intended.trim(),
            hs: draft.hs.trim(),
            gradYear: draft.gradYear.trim() || "",
            location: draft.location.trim(),
          },
          testing: { sat, satNote },
          storyNotes: {
            activities: story.activities,
            awards: story.awards,
            other: story.other,
          },
          listPrefs: {
            ambition: prefs.ambition || "balanced",
            settings: prefs.settings || [],
            size: prefs.size || "any",
            regions: prefs.regions || [],
            notes: prefs.notes || "",
          },
        }),
      });
      const saveJ = await saveRes.json();
      if (!saveRes.ok || saveJ.success === false) {
        throw new Error(saveJ.error || "Could not save onboarding.");
      }

      setBuildLog("Asking the AI to build your hub…");

      const prompt = buildAiPrompt({ draft, story, prefs, mustHave, uploads });
      const aiPrefs = loadAiPrefs();
      const body = {
        messages: [{ role: "user", content: prompt }],
      };
      if (aiPrefs.preferred && aiPrefs.preferred !== "auto") body.provider = aiPrefs.preferred;
      if (aiPrefs.grokModel) body.grokModel = aiPrefs.grokModel;
      if (aiPrefs.codexModel) body.codexModel = aiPrefs.codexModel;
      if (aiPrefs.opencodeModel) body.opencodeModel = aiPrefs.opencodeModel;

      const chatRes = await fetch("/api/ai/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!chatRes.ok || !chatRes.body) {
        let msg = `AI request failed (${chatRes.status}).`;
        try {
          const j = await chatRes.json();
          if (j.error) msg = j.error;
        } catch (e) {}
        throw new Error(msg + " Your basics were saved — open the hub and ask the copilot to finish.");
      }

      const reader = chatRes.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (!line.trim()) continue;
          let ev;
          try {
            ev = JSON.parse(line);
          } catch (e) {
            continue;
          }
          if (ev.type === "status") setBuildLog(ev.message || "Working…");
          else if (ev.type === "tool") {
            setBuildLog(`Updating hub: ${ev.name}${ev.path ? ` (${ev.path})` : ""}…`);
          } else if (ev.type === "error") {
            throw new Error(ev.message || "AI error while building.");
          } else if (ev.type === "done") {
            setBuildLog("Finishing up…");
          }
        }
      }

      setBuildLog("Loading your hub…");
      const wsRes = await fetch("/api/workspace", { credentials: "same-origin", cache: "no-store" });
      const ws = await wsRes.json();
      setBuildStatus("done");
      setBuildLog("Done");
      // Brief beat so the user sees success, then hand off
      await new Promise((r) => setTimeout(r, 600));
      if (onComplete) await onComplete(ws.data || ws);
    } catch (e) {
      setBuildStatus("idle");
      setBuildLog("");
      setErr(e.message || "Could not build hub.");
      // Basics may already be saved; still try to unlock if workspace is complete
      try {
        const wsRes = await fetch("/api/workspace", { credentials: "same-origin", cache: "no-store" });
        const ws = await wsRes.json();
        const dataWs = ws.data || ws;
        if (dataWs && dataWs.onboarding && dataWs.onboarding.completed && onComplete) {
          // Offer path forward via error + allow manual open — do not auto-complete on failure mid-build
        }
      } catch (e2) {}
    }
    setBusy(false);
  };

  const id = STEPS[step].id;
  const isLast = step === STEPS.length - 1;
  const building = buildStatus === "building";

  return (
    <div className="cf-onboard">
      <div className="cf-onboard__shell">
        <header className="cf-onboard__header">
          <div className="cf-onboard__brand">
            <span aria-hidden className="cf-hub-nav__mark">✱</span>
            <span className="cf-display" style={{ fontSize: 20, color: "var(--ink)" }}>College Forge</span>
          </div>
          <Progress step={step} />
        </header>

        <main className="cf-onboard__main">
          {id === "welcome" ? (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "var(--coral)", marginBottom: 10 }}>
                Get started
              </div>
              <h1 className="cf-display" style={{ margin: "0 0 12px", fontSize: "clamp(28px, 4vw, 36px)", letterSpacing: "-0.5px", color: "var(--ink)", textWrap: "balance" }}>
                Set up your applications hub
              </h1>
              <p style={{ margin: "0 0 20px", fontSize: 15, lineHeight: 1.65, color: "var(--body)", maxWidth: 540, textWrap: "pretty" }}>
                Connect an AI, share who you are and as much of your story as you want, tune college-list preferences,
                then let the copilot build your hub and a preliminary school list.
              </p>
              <ul className="cf-onboard-checklist">
                <li>Connect Grok or ChatGPT</li>
                <li>Basics, academics, activities, awards — pile on detail</li>
                <li>List strategy: ambitious, just right, or conservative</li>
                <li>AI builds profile + preliminary college list</li>
              </ul>
            </div>
          ) : null}

          {id === "connect" ? <ConnectStep status={provider} onConnected={loadStatus} /> : null}

          {id === "identity" ? (
            <div>
              <h2 className="cf-display" style={{ margin: "0 0 8px", fontSize: 26, color: "var(--ink)" }}>
                About you
              </h2>
              <p style={{ margin: "0 0 20px", fontSize: 14, color: "var(--body)", lineHeight: 1.6 }}>
                This powers Overview and Profile. Required fields are marked.
              </p>
              <div style={{ maxWidth: 440 }}>
                <OnboardField label="Full name" required>
                  <OnboardInput value={draft.name} onChange={set("name")} placeholder="Alex Rivera" autoComplete="name" />
                </OnboardField>
                <OnboardField label="Graduation year" required hint="e.g. 2027">
                  <OnboardInput value={draft.gradYear} onChange={set("gradYear")} placeholder="2027" inputMode="numeric" />
                </OnboardField>
                <OnboardField label="High school" required>
                  <OnboardInput value={draft.hs} onChange={set("hs")} placeholder="Lincoln High School" />
                </OnboardField>
                <OnboardField label="Intended major" required>
                  <OnboardInput value={draft.intended} onChange={set("intended")} placeholder="Computer Science" />
                </OnboardField>
                <OnboardField label="Location" hint="City, State — optional">
                  <OnboardInput value={draft.location} onChange={set("location")} placeholder="Austin, TX" />
                </OnboardField>
              </div>
            </div>
          ) : null}

          {id === "academics" ? (
            <div>
              <h2 className="cf-display" style={{ margin: "0 0 8px", fontSize: 26, color: "var(--ink)" }}>
                Academics
              </h2>
              <p style={{ margin: "0 0 20px", fontSize: 14, color: "var(--body)", lineHeight: 1.6 }}>
                At least one GPA is required. SAT is optional — mark test-optional if you’re not reporting scores.
              </p>
              <div style={{ maxWidth: 440 }}>
                <OnboardField label="Weighted GPA" required={!present(draft.gpaUnweighted)}>
                  <OnboardInput value={draft.gpaWeighted} onChange={set("gpaWeighted")} placeholder="4.28" inputMode="decimal" />
                </OnboardField>
                <OnboardField label="Unweighted GPA" required={!present(draft.gpaWeighted)}>
                  <OnboardInput value={draft.gpaUnweighted} onChange={set("gpaUnweighted")} placeholder="3.95" inputMode="decimal" />
                </OnboardField>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink)", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={draft.testOptional}
                      onChange={(e) => setDraft((d) => ({ ...d, testOptional: e.target.checked }))}
                    />
                    Test optional — I’m not reporting SAT/ACT
                  </label>
                </div>
                {!draft.testOptional ? (
                  <>
                    <OnboardField label="SAT (superscore)" hint="Optional">
                      <OnboardInput value={draft.sat} onChange={set("sat")} placeholder="1540" inputMode="numeric" />
                    </OnboardField>
                    <OnboardField label="SAT note" hint="e.g. 790 M / 750 EBRW — optional">
                      <OnboardInput value={draft.satNote} onChange={set("satNote")} placeholder="790 M / 750 EBRW" />
                    </OnboardField>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {id === "story" ? <StoryStep story={story} onChange={setStory} /> : null}

          {id === "prefs" ? (
            <PrefsStep
              prefs={prefs}
              onChange={setPrefs}
              mustHave={mustHave}
              onMustHaveChange={setMustHave}
            />
          ) : null}

          {id === "upload" ? (
            <UploadStep
              uploads={uploads}
              onUploaded={(saved) => setUploads((u) => {
                const names = new Set(u.map((x) => x.name));
                const merged = [...u];
                for (const s of saved) {
                  if (!names.has(s.name)) merged.push(s);
                }
                return merged;
              })}
            />
          ) : null}

          {id === "build" ? (
            <BuildStep
              draft={draft}
              story={story}
              prefs={prefs}
              mustHave={mustHave}
              uploads={uploads}
              providerLabel={providerLabel}
              buildStatus={buildStatus}
              buildLog={buildLog}
            />
          ) : null}

          {err ? (
            <p role="alert" style={{ margin: "20px 0 0", color: "var(--error)", fontSize: 13 }}>
              {err}
            </p>
          ) : null}
        </main>

        <footer className="cf-onboard__footer">
          <div>
            {step > 0 && !building && buildStatus !== "done" ? (
              <OnboardButton variant="secondary" size="md" onClick={goBack} disabled={busy}>
                Back
              </OnboardButton>
            ) : (
              <span />
            )}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {id === "upload" ? (
              <OnboardButton variant="secondary" size="md" onClick={goNext} disabled={busy || building}>
                Skip
              </OnboardButton>
            ) : null}
            {isLast ? (
              buildStatus === "done" ? null : (
                <OnboardButton size="md" onClick={finish} disabled={busy || building || !canNext()}>
                  {building ? "Building…" : "Build my hub ✱"}
                </OnboardButton>
              )
            ) : (
              <OnboardButton size="md" onClick={goNext} disabled={busy || building || !canNext()}>
                Continue
              </OnboardButton>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

window.Onboarding = Onboarding;
