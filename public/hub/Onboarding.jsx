const { Button, Input, Badge } = window.CollegeForgeDesignSystem_e95e63;

// Steps: welcome → connect → identity → academics → schools → upload → review
const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "connect", label: "AI" },
  { id: "identity", label: "You" },
  { id: "academics", label: "Academics" },
  { id: "schools", label: "Schools" },
  { id: "upload", label: "Upload" },
  { id: "review", label: "Review" },
];

function present(v) {
  const s = String(v ?? "").trim();
  return Boolean(s) && s !== "—";
}

function FieldLabel({ children, hint, required }) {
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

function Field({ label, hint, required, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <FieldLabel required={required} hint={hint}>{label}</FieldLabel>
      {children}
    </div>
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

// ── Connect (same OAuth dance as AiChat) ─────────────────────────────────
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
          The copilot will use your {activeLabel} account. You can continue to set up your hub.
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
        Nothing in the hub works until one is connected.
      </p>

      {!flow ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 360 }}>
          <Button size="md" onClick={() => start("grok")} disabled={busy} style={{ justifyContent: "center" }}>
            Connect Grok
          </Button>
          <Button size="md" variant="secondary" onClick={() => start("codex")} disabled={busy} style={{ justifyContent: "center" }}>
            Connect ChatGPT
          </Button>
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
          <Input
            value={callback}
            onChange={(e) => setCallback(e.target.value)}
            placeholder="Paste the localhost URL from the address bar…"
          />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button size="sm" onClick={complete} disabled={busy || !callback.trim()}>
              Finish sign-in
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { setFlow(null); setErr(""); }} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {err ? <p style={{ margin: "14px 0 0", color: "var(--error)", fontSize: 13 }}>{err}</p> : null}
    </div>
  );
}

// ── Schools (Scorecard search, same API as Explore) ──────────────────────
function SchoolsStep({ selected, onChange, max = 3 }) {
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
        body: JSON.stringify({ college }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Could not add.");
      const list = (j.data && j.data.colleges) || [];
      const added = list.find((x) => x.slug === c.slug) || college;
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
      <h2 className="cf-display" style={{ margin: "0 0 8px", fontSize: 26, color: "var(--ink)" }}>
        Starter schools
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--body)", lineHeight: 1.6, maxWidth: 520 }}>
        Search any U.S. college (College Scorecard) and add 1–{max} schools you’re considering. You can expand the list later in Explore.
      </p>

      {selected.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {selected.map((c) => (
            <div
              key={c.slug}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 14px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--hairline)",
                background: "var(--surface-card)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{c.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  {[c.location, c.admit ? `${c.admit} admit` : null, c.satRange ? `SAT ${c.satRange}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => remove(c)} disabled={busySlug === c.slug}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {selected.length < max ? (
        <div>
          <Field label="Search schools" required={selected.length === 0} hint="Type at least 2 letters">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="e.g. Stanford, MIT, Tufts…"
              autoComplete="off"
            />
          </Field>
          {searching ? (
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>Searching…</div>
          ) : null}
          {results.length > 0 ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflow: "auto" }}>
              {results.slice(0, 12).map((c) => {
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
            <div style={{ fontSize: 13, color: "var(--muted)" }}>No schools found.</div>
          ) : null}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
          You’ve added {max} schools — enough to get started. Add more later in Explore.
        </p>
      )}
      {error ? <p style={{ margin: "12px 0 0", color: "var(--error)", fontSize: 13 }}>{error}</p> : null}
    </div>
  );
}

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
        <Badge variant="cream" uppercase>Optional</Badge>
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--body)", lineHeight: 1.6, maxWidth: 520 }}>
        Transcript, resume, or activities list. The copilot can read these later to flesh out activities, honors, and coursework. You can skip this step.
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
        <Button size="md" variant="secondary" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>
          {busy ? "Uploading…" : "Choose files"}
        </Button>
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

function ReviewStep({ draft, schools, uploads, providerLabel }) {
  const row = (label, value) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "8px 0", borderBottom: "1px solid var(--hairline-soft)" }}>
      <span style={{ fontSize: 13, color: "var(--muted)" }}>{label}</span>
      <span style={{ fontSize: 13, color: "var(--ink)", textAlign: "right" }}>{present(value) ? value : "—"}</span>
    </div>
  );
  return (
    <div>
      <h2 className="cf-display" style={{ margin: "0 0 8px", fontSize: 26, color: "var(--ink)" }}>
        Review & open your hub
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--body)", lineHeight: 1.6 }}>
        Confirm everything looks right. You can edit any of this later with the copilot or on Profile.
      </p>
      <div className="cf-onboard-card" style={{ maxWidth: 480 }}>
        {row("AI", providerLabel || "Connected")}
        {row("Name", draft.name)}
        {row("Grad year", draft.gradYear)}
        {row("High school", draft.hs)}
        {row("Location", draft.location)}
        {row("Intended major", draft.intended)}
        {row("GPA (W)", draft.gpaWeighted)}
        {row("GPA (UW)", draft.gpaUnweighted)}
        {row("SAT", draft.testOptional ? "Test optional" : draft.sat)}
        {row("Schools", schools.map((c) => c.short || c.name).join(", ") || "—")}
        {row("Uploads", uploads.length ? uploads.map((u) => u.name).join(", ") : "None")}
      </div>
    </div>
  );
}

function Onboarding({ data, onComplete }) {
  const [step, setStep] = React.useState(0);
  const [provider, setProvider] = React.useState(null);
  const [schools, setSchools] = React.useState(() => (data && data.colleges) || []);
  const [uploads, setUploads] = React.useState(() => (data && data.uploads) || []);
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const a = (data && data.applicant) || {};
  const p = (data && data.profile) || {};
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

  // Keep schools in sync if parent data refreshes mid-flow
  React.useEffect(() => {
    if (data && data.colleges && data.colleges.length && schools.length === 0) {
      setSchools(data.colleges.slice(0, 3));
    }
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
  const schoolsOk = schools.length >= 1;

  const canNext = () => {
    const id = STEPS[step].id;
    if (id === "welcome") return true;
    if (id === "connect") return Boolean(connected);
    if (id === "identity") return Boolean(identityOk);
    if (id === "academics") return Boolean(academicsOk);
    if (id === "schools") return Boolean(schoolsOk);
    if (id === "upload") return true;
    if (id === "review") return true;
    return false;
  };

  const stepError = () => {
    const id = STEPS[step].id;
    if (id === "connect" && !connected) return "Connect Grok or ChatGPT to continue.";
    if (id === "identity" && !identityOk) return "Name, high school, intended major, and grad year are required.";
    if (id === "academics" && !academicsOk) return "Enter at least one GPA (weighted or unweighted).";
    if (id === "schools" && !schoolsOk) return "Add at least one school.";
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
    setErr("");
    if (step > 0) setStep((s) => s - 1);
  };

  const finish = async () => {
    if (!canNext()) {
      setErr(stepError() || "Fill required fields first.");
      return;
    }
    // Re-check AI + minimums before unlock
    const fresh = await loadStatus();
    if (!fresh || !fresh.active) {
      setErr("AI connection lost. Go back to Connect and sign in again.");
      setStep(1);
      return;
    }
    if (!identityOk || !academicsOk || !schoolsOk) {
      setErr("Some required fields are missing. Go back and complete them.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const sat = draft.testOptional ? "—" : draft.sat.trim() || "—";
      const satNote = draft.testOptional ? "Test optional" : draft.satNote.trim();
      const res = await fetch("/api/workspace", {
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
        }),
      });
      const j = await res.json();
      if (!res.ok || j.success === false) throw new Error(j.error || "Could not save onboarding.");
      const ws = j.data || j;
      if (onComplete) await onComplete(ws);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const id = STEPS[step].id;
  const isLast = step === STEPS.length - 1;

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
              <p style={{ margin: "0 0 20px", fontSize: 15, lineHeight: 1.65, color: "var(--body)", maxWidth: 520, textWrap: "pretty" }}>
                In a few steps you’ll connect an AI for the copilot, enter the basics about you and your academics,
                pick starter schools, and optionally upload a transcript or resume. Then the full hub unlocks.
              </p>
              <ul className="cf-onboard-checklist">
                <li>Connect Grok or ChatGPT (required)</li>
                <li>Name, school, major, GPA, and 1–3 colleges</li>
                <li>Optional documents for the copilot to parse later</li>
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
                <Field label="Full name" required>
                  <Input value={draft.name} onChange={set("name")} placeholder="Alex Rivera" autoComplete="name" />
                </Field>
                <Field label="Graduation year" required hint="e.g. 2027">
                  <Input value={draft.gradYear} onChange={set("gradYear")} placeholder="2027" inputMode="numeric" />
                </Field>
                <Field label="High school" required>
                  <Input value={draft.hs} onChange={set("hs")} placeholder="Lincoln High School" />
                </Field>
                <Field label="Intended major" required>
                  <Input value={draft.intended} onChange={set("intended")} placeholder="Computer Science" />
                </Field>
                <Field label="Location" hint="City, State — optional">
                  <Input value={draft.location} onChange={set("location")} placeholder="Austin, TX" />
                </Field>
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
                <Field label="Weighted GPA" required={!present(draft.gpaUnweighted)}>
                  <Input value={draft.gpaWeighted} onChange={set("gpaWeighted")} placeholder="4.28" inputMode="decimal" />
                </Field>
                <Field label="Unweighted GPA" required={!present(draft.gpaWeighted)}>
                  <Input value={draft.gpaUnweighted} onChange={set("gpaUnweighted")} placeholder="3.95" inputMode="decimal" />
                </Field>
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
                    <Field label="SAT (superscore)" hint="Optional">
                      <Input value={draft.sat} onChange={set("sat")} placeholder="1540" inputMode="numeric" />
                    </Field>
                    <Field label="SAT note" hint="e.g. 790 M / 750 EBRW — optional">
                      <Input value={draft.satNote} onChange={set("satNote")} placeholder="790 M / 750 EBRW" />
                    </Field>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {id === "schools" ? (
            <SchoolsStep selected={schools} onChange={setSchools} max={3} />
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

          {id === "review" ? (
            <ReviewStep draft={draft} schools={schools} uploads={uploads} providerLabel={providerLabel} />
          ) : null}

          {err ? (
            <p role="alert" style={{ margin: "20px 0 0", color: "var(--error)", fontSize: 13 }}>
              {err}
            </p>
          ) : null}
        </main>

        <footer className="cf-onboard__footer">
          <div>
            {step > 0 ? (
              <Button variant="secondary" size="md" onClick={goBack} disabled={busy}>
                Back
              </Button>
            ) : (
              <span />
            )}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {id === "upload" ? (
              <Button variant="secondary" size="md" onClick={goNext} disabled={busy}>
                Skip
              </Button>
            ) : null}
            {isLast ? (
              <Button size="md" onClick={finish} disabled={busy || !canNext()}>
                {busy ? "Saving…" : "Open my hub ✱"}
              </Button>
            ) : (
              <Button size="md" onClick={goNext} disabled={busy || !canNext()}>
                Continue
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

window.Onboarding = Onboarding;
