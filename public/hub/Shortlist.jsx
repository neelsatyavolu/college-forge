const { Badge, VerdictBadge, SectionLabel, Button } = window.CollegeForgeDesignSystem_e95e63;

const TIER_META = {
  reach: { label: "Reaches", dot: "var(--error)" },
  target: { label: "Targets", dot: "var(--accent-amber)" },
  safety: { label: "Likely", dot: "var(--accent-teal)" },
};

const SUPP_STYLE = {
  "No supps": { bg: "color-mix(in srgb, var(--success) 14%, transparent)", color: "var(--success)" },
  "Supps optional": { bg: "color-mix(in srgb, var(--warning) 16%, transparent)", color: "var(--warning)" },
  "Supps required": { bg: "var(--surface-card)", color: "var(--muted)" },
};

function SuppPill({ load }) {
  const s = SUPP_STYLE[load] || SUPP_STYLE["Supps required"];
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "var(--radius-xs)", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.4px", background: s.bg, color: s.color }}>{load || "—"}</span>
  );
}

const EFFECT_MARK = { up: "+", down: "−", neutral: "·" };

// Same hash as profileFingerprint in lib/admission-odds.ts; change both together.
function profileFingerprint(ws) {
  const field = (v) => { const s = String(v == null ? "" : v).trim(); return s === "—" ? "" : s; };
  const a = (ws && ws.applicant) || {};
  const p = (ws && ws.profile) || {};
  const t = p.testing || {};
  const parts = [
    field(a.gpaUnweighted), field(a.gpaWeighted), field(a.sat) || field(t.sat), field(t.act),
    field(a.satNote) || field(t.satNote), field(p.intended).toLowerCase(), field(p.residency).toUpperCase(),
  ];
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(parts)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** True when an estimate records a profile that no longer matches. Estimates saved before fingerprints existed are left alone. */
function isStaleOdds(odds, fingerprint) {
  return !!(odds && odds.profileFingerprint && odds.profileFingerprint !== fingerprint);
}

// The saved chance estimate for one school, with its reasons behind a toggle.
function OddsLine({ odds, stale }) {
  const [open, setOpen] = React.useState(false);
  if (!odds) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span className="cf-nums" style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{odds.percent}% chance</span>
        <span className="cf-nums" style={{ fontSize: 12, color: "var(--muted)" }}>likely range {odds.low}–{odds.high}% · from {odds.baselineSource}</span>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
          style={{ fontSize: 12, color: "var(--workspace-accent)", background: "none", border: 0, padding: 0, cursor: "pointer" }}>{open ? "Hide why" : "Why"}</button>
      </div>
      {stale ? <div style={{ fontSize: 12, color: "var(--warning)", marginTop: 4 }}>Estimated before your profile changed</div> : null}
      {open ? (
        <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: "2px solid var(--hairline)", fontSize: 13, color: "var(--body)" }}>
          <p style={{ margin: "0 0 8px" }}>{odds.summary}</p>
          {odds.factors && odds.factors.length ? (
            <ul style={{ margin: "0 0 8px", padding: 0, listStyle: "none" }}>
              {odds.factors.map((f, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  <span className="cf-nums" aria-label={f.effect} style={{ display: "inline-block", width: 14, color: f.effect === "up" ? "var(--success)" : f.effect === "down" ? "var(--error)" : "var(--muted)" }}>{EFFECT_MARK[f.effect] || "·"}</span>
                  <strong style={{ fontWeight: 600 }}>{f.label}</strong>{f.detail ? `: ${f.detail}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {odds.sources && odds.sources.length ? (
            <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 10, flexWrap: "wrap" }}>
              Sources:
              {odds.sources.filter((u) => /^https:\/\//.test(u)).map((u) => {
                let host = u;
                try { host = new URL(u).hostname.replace(/^www\./, ""); } catch (e) {}
                return <a key={u} href={u} target="_blank" rel="noopener noreferrer" style={{ color: "var(--workspace-accent)" }}>{host}</a>;
              })}
            </div>
          ) : null}
          <div className="cf-nums" style={{ fontSize: 12, color: "var(--muted-soft)", marginTop: 6 }}>Estimated {String(odds.estimatedAt).slice(0, 10)}</div>
        </div>
      ) : null}
    </div>
  );
}

// Runs the read step, then a few schools at a time, the same way the hub build does.
const ODDS_CONCURRENCY = 3;
async function loadWorkspace() {
  const j = await fetch("/api/workspace", { credentials: "same-origin", cache: "no-store" }).then((r) => r.json());
  return j.data || j;
}

// Counts only what this run saved, so a provider without hub tools (or a refused write) never reads as success.
// onProgress(text, done, total): done and total count the read step plus one per school, for a progress bar.
// Schools whose estimate didn't save get one automatic retry, so a run covers every school it can.
async function runOddsSteps(onProgress) {
  const before = await loadWorkspace();
  const scope = before.draftStorageKey;
  const readBefore = before.applicationRead ? before.applicationRead.readAt : "";
  const stamp = (ws, key) => (ws.admissionOdds && ws.admissionOdds[key] ? ws.admissionOdds[key].estimatedAt : "");
  const sameWorkspace = () => !window.CF_DATA || !window.CF_DATA.draftStorageKey || window.CF_DATA.draftStorageKey === scope;
  onProgress("Looking up admission rates…", 0, 1);
  const res = await fetch("/api/ai/odds-plan", { credentials: "same-origin", cache: "no-store" });
  const plan = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(plan.error || "Could not start the estimate.");
  if (!(plan.schools || []).length) return { ws: before, total: 0, missed: [] };
  const steps = plan.schools || [];
  const schoolCount = steps.reduce((n, s) => n + (s.keys || []).length, 0);
  const total = 1 + schoolCount;
  await window.cfStreamBuildChat(plan.read.prompt, (m) => onProgress(`Reading your application: ${m}`, 0, total));
  const afterRead = await loadWorkspace();
  if (!sameWorkspace() || afterRead.draftStorageKey !== scope) throw new Error("Your workspace changed, so the estimate stopped.");
  if (!afterRead.applicationRead || afterRead.applicationRead.readAt === readBefore) {
    throw new Error("The AI didn't save its read of your application. Estimates need ChatGPT or Grok connected in Settings.");
  }
  let schoolsDone = 0;
  const runAll = async (list, retry) => {
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        if (!sameWorkspace()) return;
        const step = list[next++];
        const tag = retry ? "Retrying " : "";
        try {
          await window.cfStreamBuildChat(step.prompt, (m) => onProgress(`${tag}${step.label}: ${m}`, 1 + schoolsDone, total));
        } catch (e) { /* counted below from what was saved */ }
        if (!retry) schoolsDone += (step.keys || []).length;
        onProgress(`${schoolsDone} of ${schoolCount} schools estimated`, 1 + schoolsDone, total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(ODDS_CONCURRENCY, list.length) }, worker));
  };
  await runAll(steps, false);
  const unsaved = (ws) => (s) => (s.keys || []).some((k) => !stamp(ws, k) || stamp(ws, k) === stamp(before, k));
  const mid = await loadWorkspace();
  const retry = steps.filter(unsaved(mid));
  if (retry.length && sameWorkspace()) await runAll(retry, true);
  const ws = retry.length ? await loadWorkspace() : mid;
  if (ws.draftStorageKey !== scope) throw new Error("Your workspace changed, so the estimate stopped.");
  const nameOf = (k) => {
    const hit = k.indexOf("app:") === 0
      ? ((ws.tracker && ws.tracker.apps) || []).find((a) => "app:" + a.id === k)
      : (ws.colleges || []).find((c) => c.slug === k);
    return hit ? hit.short || hit.name : k;
  };
  const missed = steps.flatMap((s) => (s.keys || []).filter((k) => !stamp(ws, k) || stamp(ws, k) === stamp(before, k)).map(nameOf));
  return { ws, total: schoolCount, missed };
}

/** The estimate's progress: a thin bar with the percent, and what it's doing now on one line. */
function OddsProgress({ frac, text }) {
  const pct = Math.round(frac * 100);
  return (
    <span role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Estimating your chances" style={{ display: "grid", gap: 5 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, height: 4, borderRadius: 999, background: "var(--surface-cream-strong)", overflow: "hidden" }}>
          <span style={{ display: "block", height: "100%", width: `${Math.max(3, pct)}%`, background: "var(--coral)", borderRadius: 999, transition: "width 300ms ease" }} />
        </span>
        <span className="cf-nums" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", minWidth: 32, textAlign: "right" }}>{pct}%</span>
      </span>
      <span style={{ fontSize: 12, lineHeight: 1.35, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
    </span>
  );
}

/** The header button while estimating: the same pill, filling left to right, with the count; the step is the tooltip. */
function OddsPill({ frac, text }) {
  const pct = Math.round(frac * 100);
  const m = /(\d+) of (\d+) schools/.exec(text || "");
  return (
    <span className="cf-odds-pill cf-nums" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Estimating your chances" title={text}
      style={{ "--fill": `${Math.max(4, pct)}%` }}>
      <span>Estimating {m ? `${m[1]} of ${m[2]}` : `${pct}%`}</span>
    </span>
  );
}

/** A tracked application's chance estimate: by its own key ("app:<id>"), or its shortlist school's slug. */
function oddsForApp(data, app) {
  const oddsMap = (data && data.admissionOdds) || {};
  const listed = ((data && data.colleges) || []).find((c) => c.slug === app.slug || String(c.name || "").toLowerCase() === String(app.name || "").toLowerCase());
  return oddsMap["app:" + app.id] || (listed ? oddsMap[listed.slug] : null) || null;
}

function ChancesPanel({ data, onWorkspaceChange, compact }) {
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState("");
  const [result, setResult] = React.useState(null);
  const estimated = Object.keys(data.admissionOdds || {});
  const fingerprint = profileFingerprint(data);
  const staleCount = estimated.filter((k) => isStaleOdds(data.admissionOdds[k], fingerprint)).length;
  const [frac, setFrac] = React.useState(0);
  const run = async () => {
    setRunning(true); setResult(null); setProgress("Starting…"); setFrac(0);
    try {
      const { ws, total, missed } = await runOddsSteps((text, done, of) => { setProgress(text); if (of) setFrac(Math.min(1, done / of)); });
      if (onWorkspaceChange) onWorkspaceChange(ws);
      setResult(!total
        ? { tone: "ok", text: "Every school on your list already has a decision." }
        : missed.length
          ? { tone: "error", text: `Estimated ${total - missed.length} of ${total} schools. Not saved for: ${missed.join(", ")}. Run it again to retry.` }
          : { tone: "ok", text: `Estimated all ${total} schools.` });
    } catch (e) {
      setResult({ tone: "error", text: e.message || "The estimate stopped. Try again." });
    } finally { setRunning(false); setProgress(""); setFrac(0); }
  };
  const label = running ? "Estimating…" : staleCount ? "Re-estimate chances" : estimated.length ? "Estimate chances again" : "Estimate my chances";
  if (compact) {
    // A header button (Progress); progress, results and a stale warning show in one short line under it.
    const line = running ? "" : result ? result.text : staleCount ? `${staleCount} of ${estimated.length} estimates predate profile changes.` : "";
    return (
      <span style={{ position: "relative", display: "inline-flex" }}>
        {running ? <OddsPill frac={frac} text={progress} /> : <Button size="sm" variant="secondary" onClick={run}
          title="The AI reads your profile, essays, each school's supplements and your uploads, starts from each school's published rate for your round, and can move at most threefold from it. A rough guide.">{label}</Button>}
        {line ? <span role="status" aria-live="polite" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: "max-content", maxWidth: 320, zIndex: 2, fontSize: 12, lineHeight: 1.35, textAlign: "right", color: result && result.tone === "error" ? "var(--error)" : staleCount && !running && !result ? "var(--warning)" : "var(--muted)" }}>{line}</span> : null}
      </span>
    );
  }
  return (
    <section style={{ marginBottom: 28, padding: "16px 20px", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <h2 className="cf-display" style={{ margin: "0 0 4px", fontSize: 20, color: "var(--ink)" }}>Your chances</h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--body)" }}>
            The AI reads your profile, essays and uploads, looks at each school's published admission rates and what it weighs, and counts any decisions you already have. Each estimate starts from the school's published rate for your round and can move at most threefold from it. Treat it as a rough guide.
          </p>
        </div>
        <Button size="sm" disabled={running} onClick={run}>{running ? "Estimating…" : staleCount ? "Re-estimate" : estimated.length ? "Estimate again" : "Estimate my chances"}</Button>
      </div>
      {staleCount && !running ? (
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--warning)" }}>
          {staleCount === estimated.length ? "Estimated before your profile changed." : `${staleCount} of ${estimated.length} estimates were made before your profile changed.`} Re-estimate to use your current scores.
        </p>
      ) : null}
      {running ? <div style={{ marginTop: 12, maxWidth: 520 }}><OddsProgress frac={frac} text={progress} /></div> : (
        <div role="status" aria-live="polite" style={{ fontSize: 13, marginTop: result ? 10 : 0, color: result && result.tone === "error" ? "var(--error)" : "var(--muted)" }}>
          {result ? result.text : ""}
        </div>
      )}
    </section>
  );
}

const RESEARCH_GROUPS = [
  ["Admissions", [["admit_rate", "Admit rate"], ["ed_admit_rate", "Early admit rate"], ["sat_mid50", "SAT middle 50%"], ["act_mid50", "ACT middle 50%"], ["gpa_note", "GPA"], ["test_policy", "Testing"]]],
  ["Cost and aid", [["sticker_cost", "Cost of attendance"], ["meets_full_need", "Need-based aid"], ["css_profile", "CSS Profile"], ["merit_aid", "Merit aid"], ["net_price_lt30k", "Net price, under $30k income"], ["net_price_30_48k", "Net price, $30–48k"], ["net_price_48_75k", "Net price, $48–75k"], ["net_price_75_110k", "Net price, $75–110k"], ["net_price_gt110k", "Net price, over $110k"]]],
  ["Applying", [["ed_ea_options", "Early rounds"], ["interview", "Interview"], ["demonstrated_interest", "Demonstrated interest"], ["major_notes", "Your major"], ["notes", "Notes"]]],
];

/** Sourced facts from setup research, grouped, each linked to the page it came from. */
function ResearchFacts({ research }) {
  if (!research || !(research.facts || []).length) return null;
  const facts = research.facts;
  return (
    <details className="cf-research">
      <summary>
        Research · <span className="cf-nums">{facts.length} facts · checked {research.checkedAt}</span>
        {research.needsReview ? <span className="cf-research-flag"> · some facts still need checking</span> : null}
      </summary>
      {RESEARCH_GROUPS.map(([group, keys]) => {
        const rows = keys.flatMap(([key, label]) => facts.filter((f) => f.key === key).map((f, i) => ({ f, label, id: key + i })));
        if (!rows.length) return null;
        return (
          <div key={group} className="cf-research-group">
            <h4>{group}</h4>
            <dl>
              {rows.map(({ f, label, id }) => (
                <div key={id}>
                  <dt>{label}</dt>
                  <dd>
                    {f.value}{" "}
                    {/^https?:\/\//.test(f.sourceUrl) ? <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer">source</a> : null}
                    {f.cycle !== "2026-27" ? <span className="cf-research-tag">{f.cycle} cycle</span> : null}
                    {f.thirdParty ? <span className="cf-research-tag">third-party</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </details>
  );
}

function SchoolRow({ s, odds, oddsStale, last, tracked, onTier, onTrack, onRemove, busy, error }) {
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  return (
    <div style={{ display: "block", background: s.priority ? "color-mix(in srgb, var(--coral) 5%, transparent)" : "transparent", borderBottom: last ? "none" : "1px solid var(--hairline)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16, alignItems: "center", padding: "16px 20px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <h3 className="cf-display" style={{ margin: 0, fontSize: 19, lineHeight: 1.3, color: "var(--ink)" }}>{s.name || s.short}</h3>
            {s.priority ? <Badge variant="coral" uppercase>Priority</Badge> : null}
            {isUcCampus(s) ? <Badge variant="teal" uppercase>UC Application</Badge> : null}
          </div>
          <div style={{ fontSize: 13, color: "var(--body)", marginBottom: 6 }}>
            {s.major || "—"}
            {s.location ? <span style={{ color: "var(--muted-soft)" }}> · {s.location}</span> : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <SuppPill load={s.supplementsNeeded === "no" ? "No supps" : s.supp} />
            {s.deadline ? (
              <span style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.5px", color: "var(--muted)" }}>{s.deadline}</span>
            ) : null}
            {s.admit ? <span className="cf-nums" style={{ fontSize: 12, color: "var(--muted)" }}>Overall admission rate: {s.admit}</span> : null}
            {s.netPriceForYou ? <span className="cf-nums" style={{ fontSize: 12, color: "var(--muted)" }}>Your likely cost: {s.netPriceForYou}</span> : null}
          </div>
          <OddsLine odds={odds} stale={oddsStale} />
          <ResearchFacts research={s.research} />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
              Tier
              <select disabled={busy} value={TIER_META[s.tier] ? s.tier : ""} onChange={(e) => onTier(s.slug, e.target.value)}
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: "var(--radius-xs)", border: "1px solid var(--hairline)", background: "var(--canvas)", color: "var(--ink)" }}>
                <option value="" disabled>Not assessed</option>
                <option value="reach">Reach</option>
                <option value="target">Target</option>
                <option value="safety">Likely</option>
              </select>
            </label>
            {tracked
              ? <a href="#progress" style={{ fontSize: 12, color: "var(--workspace-accent)" }}>Applying · {tracked.statusLabel} →</a>
              : <Button variant="secondary" size="sm" disabled={busy} onClick={() => onTrack(s)}>Track application</Button>}
            {!confirmRemove ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove school</Button> : null}
          </div>
          {confirmRemove ? <div style={{ marginTop: 12, padding: 12, background: "var(--surface-soft)", borderRadius: "var(--radius-sm)" }}>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--body)" }}>
              Remove {s.name || s.short} from your list?{" "}
              {!tracked ? "" : tracked.untouched
                ? "Its Not started application leaves Applications and Progress too. "
                : `Its application (${tracked.statusLabel}) stays on Applications and Progress, no longer linked to the list. `}
              Saved essay drafts will remain.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button size="sm" disabled={busy} onClick={() => onRemove(s.slug)}>Confirm removal</Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmRemove(false)}>Keep school</Button>
            </div>
          </div> : null}
          {error ? <p role="alert" style={{ margin: "10px 0 0", color: "var(--error)", fontSize: 13 }}>{error}</p> : null}
        </div>
        {s.verdict ? <div><VerdictBadge tone={s.verdict.tone}>{s.verdict.label}</VerdictBadge></div> : null}
      </div>
    </div>
  );
}

function isUcCampus(c) {
  const slug = String((c && c.slug) || "").toLowerCase();
  const name = String((c && (c.name || c.short)) || "").toLowerCase();
  if (slug.indexOf("university-of-california-") === 0) return true;
  if (slug === "ucla") return true;
  if (name.indexOf("university of california") !== -1) return true;
  return false;
}

/** Soft app count: all UC campuses share one UC Application slot. */
function applicationSlotCount(colleges) {
  let nonUc = 0;
  let hasUc = false;
  for (const c of colleges || []) {
    if (isUcCampus(c)) hasUc = true;
    else nonUc++;
  }
  return nonUc + (hasUc ? 1 : 0);
}

const AMBITION_STEPS = ["conservative", "balanced", "ambitious"];
const AMBITION_LABEL = { conservative: "More likely options", balanced: "Balanced mix", ambitious: "More reaches" };
const GAP_WORD = { reach: "reach", target: "target", safety: "likely" };

/** Saved gaps, recounted against the list as it is now. Gaps saved before quotas were stored stay as saved. */
function currentGaps(saved, byTier) {
  return saved
    .map((g) => (g && typeof g.goal === "number" && byTier[g.tier]
      ? { ...g, missing: g.goal - byTier[g.tier].length }
      : g))
    .filter((g) => g && g.missing > 0);
}

/** What a rebalance changed, in a sentence. */
function rebalanceSummary(added, removed) {
  const a = Array.isArray(added) ? added : [];
  const r = Array.isArray(removed) ? removed : [];
  if (!a.length && !r.length) return "Nothing changed. Every school on your list is one you or the copilot added, or the list already matches this balance.";
  return [a.length ? `Added ${a.join(", ")}.` : "", r.length ? `Removed ${r.join(", ")}.` : ""].filter(Boolean).join(" ");
}

/** Warnings for a list that leans too far one way, counted in application slots. */
function balanceWarnings(likelySlots, reachSlots, appSlots) {
  const out = [];
  if (likelySlots < 2) out.push(`Your list has ${likelySlots} likely ${likelySlots === 1 ? "school" : "schools"}. Add at least two you would be glad to attend.`);
  if (appSlots > 0 && reachSlots / appSlots > 0.5) out.push(`${reachSlots} of your ${appSlots} applications are reaches. Keeping reaches to half the list or fewer leaves room for schools you are likely to get into.`);
  return out;
}

function ListBalance({ ambition, warnings, gaps, busy, error, onShift, onRebalance }) {
  const step = AMBITION_STEPS.indexOf(ambition);
  return (
    <section aria-label="List balance" style={{ marginBottom: 28, padding: "16px 20px", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <h2 className="cf-display" style={{ margin: "0 0 4px", fontSize: 20, color: "var(--ink)" }}>List balance: {AMBITION_LABEL[ambition]}</h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--body)" }}>Rebalancing swaps only the schools Forge picked for you. Schools you added and priority schools stay.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="secondary" size="sm" disabled={busy || step >= AMBITION_STEPS.length - 1} onClick={() => onShift(1)}>More ambitious</Button>
          <Button variant="secondary" size="sm" disabled={busy || step <= 0} onClick={() => onShift(-1)}>Safer</Button>
          <Button size="sm" disabled={busy} onClick={onRebalance}>Rebalance list</Button>
        </div>
      </div>
      {warnings.length || gaps.length ? (
        <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 4, fontSize: 13, color: "var(--warning)" }}>
          {warnings.map((w) => <li key={w}>{w}</li>)}
          {gaps.map((g) => <li key={g.tier}>Rebalancing could not find {g.missing} more {GAP_WORD[g.tier] || g.tier} {g.missing === 1 ? "school" : "schools"} that fit your preferences. Add your own from Explore.</li>)}
        </ul>
      ) : null}
      {error ? <p role="alert" style={{ margin: "10px 0 0", color: "var(--error)", fontSize: 13 }}>{error}</p> : null}
    </section>
  );
}

function Shortlist({ data, tracker, onTrackerChange, onAsk, onWorkspaceChange }) {
  const [filter, setFilter] = React.useState("all");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [notice, setNotice] = React.useState("");
  const trackedApps = (tracker && tracker.apps) || [];
  const trackedFor = (c) => trackedApps.find((a) => a.slug === c.slug) || trackedApps.find((a) => a.name.toLowerCase() === String(c.name || "").toLowerCase());
  const byTier = {
    reach: data.colleges.filter((c) => c.tier === "reach"),
    target: data.colleges.filter((c) => c.tier === "target"),
    safety: data.colleges.filter((c) => c.tier === "safety"),
  };
  const untiered = data.colleges.filter((c) => !c.tier || !TIER_META[c.tier]);
  const ucCount = data.colleges.filter(isUcCampus).length;
  const appSlots = applicationSlotCount(data.colleges);
  const listPrefs = (data.onboarding && data.onboarding.listPrefs) || {};
  const ambition = AMBITION_STEPS.includes(listPrefs.ambition) ? listPrefs.ambition : "balanced";
  const shownGaps = currentGaps((data.onboarding && data.onboarding.listGaps) || [], byTier);
  const warnings = balanceWarnings(applicationSlotCount(byTier.safety), applicationSlotCount(byTier.reach), appSlots);
  const fingerprint = profileFingerprint(data);
  const FILTERS = [
    { id: "all", label: "All" }, { id: "reach", label: "Reaches" },
    { id: "target", label: "Targets" }, { id: "safety", label: "Likely" },
  ];

  const saveChange = async (slug, action, message) => {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const ws = await action();
      if (onWorkspaceChange) onWorkspaceChange(ws);
      setNotice(message);
    } catch (e) {
      setError({ slug, message: e.message || "Could not save this change. Please try again." });
    } finally { setBusy(false); }
  };
  const onTier = (slug, tier) => saveChange(slug, () => window.cfApi.patch({ collegePatch: { slug, tier } }), "School tier updated.");
  const onTrack = async (c) => {
    setBusy(true); setError(null); setNotice("");
    try {
      const j = await window.cfApi.applications({ action: "add", name: c.name, slug: c.slug });
      if (onTrackerChange) onTrackerChange(j.data);
      setNotice(`${c.name} is on your Progress tab.`);
    } catch (e) { setError({ slug: c.slug, message: e.message }); } finally { setBusy(false); }
  };
  // Saves the new balance first, so a failed rebalance still keeps the choice.
  const rebalance = async (nextAmbition) => {
    let summary = "";
    await saveChange("__balance", async () => {
      if (nextAmbition) {
        const saved = await window.cfApi.patch({ listPrefs: { ambition: nextAmbition } });
        if (onWorkspaceChange) onWorkspaceChange(saved);
      }
      const j = await window.cfApi.postAction("rebalance", {});
      if (!j.data) throw new Error("Could not rebalance your list. Please try again.");
      summary = rebalanceSummary(j.added, j.removed);
      return j.data;
    }, "");
    if (summary) setNotice((nextAmbition ? `List balance set to ${AMBITION_LABEL[nextAmbition].toLowerCase()}. ` : "") + summary);
  };
  const onShift = (dir) => rebalance(AMBITION_STEPS[Math.max(0, Math.min(AMBITION_STEPS.length - 1, AMBITION_STEPS.indexOf(ambition) + dir))]);
  // Data tiers first (grades and scores vs each school's numbers); for the rest, the AI chance estimate, then
  // its tier (70%+ likely, 30-69% target, under 30% reach). Schools added from Applications arrive untiered.
  const onAssessAll = async () => {
    setBusy(true); setError(null); setNotice("Sorting schools from your grades and scores…");
    const assess = async () => {
      const j = await window.cfApi.postAction("assess-tiers", {});
      if (!j.data) throw new Error("Could not assess your schools. Please try again.");
      if (onWorkspaceChange) onWorkspaceChange(j.data);
      return j;
    };
    let sorted = 0;
    try {
      let j = await assess();
      sorted += (j.assessed || []).length;
      if ((j.unknown || []).length) {
        setNotice(`Estimating your chances with AI for ${j.unknown.length} school${j.unknown.length === 1 ? "" : "s"}…`);
        const odds = await runOddsSteps(setNotice);
        if (onWorkspaceChange && odds.ws) onWorkspaceChange(odds.ws);
        j = await assess();
        sorted += (j.assessed || []).length;
      }
      const left = j.unknown || [];
      setNotice((sorted ? `Sorted ${sorted} school${sorted === 1 ? "" : "s"} into reach, target or likely.` : "")
        + (left.length ? ` Couldn’t estimate ${left.join(", ")}; run Assess all again or pick a tier yourself.` : ""));
    } catch (e) {
      setNotice(sorted ? `Sorted ${sorted} school${sorted === 1 ? "" : "s"}.` : "");
      setError({ slug: "__assess", message: e.message || "The AI estimate stopped. Try again." });
    } finally { setBusy(false); }
  };
  const onRemove = (slug) => saveChange(slug, async () => {
    const response = await fetch(`/api/workspace/colleges?slug=${encodeURIComponent(slug)}`, { method: "DELETE", credentials: "same-origin" });
    const result = await response.json();
    if (!response.ok || !result.success || !result.data) throw new Error(result.error || "Could not remove this school. Please try again.");
    return result.data;
  }, "School removed from your list.");

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Your shortlist</h1>
          <p className="cf-page-lede">
            Schools you’re considering. Schools you add here also show on Applications and Progress as Not started; a suggested school joins them once you track or star it. Reach, target, and likely are planning categories, not admission or financial-aid guarantees. Overall admission rates are not your personal odds; Your chances below estimates those for you.
            {ucCount > 0
              ? " UC campuses share one UC Application — they count as a single app slot even if you list several campuses."
              : ""}
          </p>
          {data.colleges.length > 0 ? <a className="cf-link-btn" href="#list" style={{ display: "inline-flex", alignItems: "center" }}>See them ranked →</a> : null}
        </div>
        <Button variant="secondary" size="sm" onClick={onAsk}>Ask copilot to adjust ✱</Button>
      </header>

      <div role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", marginBottom: notice || busy ? 16 : 0 }}>{busy ? notice || "Saving change…" : notice}</div>

      {data.colleges.length > 0 ? (
        <div className="cf-grid-short-stats" style={{ marginBottom: 28 }}>
          {[
            ["Campuses", data.colleges.length],
            ["App slots", appSlots],
            ["Reaches", byTier.reach.length],
            ["Likely", byTier.safety.length],
          ].map(([l, v]) => (
            <div key={l}>
              <div className="cf-display cf-nums" style={{ fontSize: 32, lineHeight: 1, letterSpacing: "-0.5px", color: "var(--ink)" }}>{v}</div>
              <div style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.5px", color: "var(--muted)", marginTop: 4 }}>{l}</div>
            </div>
          ))}
        </div>
      ) : null}

      {data.colleges.length > 0 ? (
        <ListBalance ambition={ambition} warnings={warnings} gaps={shownGaps} busy={busy}
          error={error && error.slug === "__balance" ? error.message : ""} onShift={onShift} onRebalance={() => rebalance(null)} />
      ) : null}

      {data.colleges.length > 0 ? <ChancesPanel data={data} onWorkspaceChange={onWorkspaceChange} /> : null}

      {data.colleges.length === 0 ? (
        <div className="cf-empty">No schools on your list yet. Tell the copilot which colleges to add, or search from Explore.</div>
      ) : (
        <React.Fragment>
          <div style={{ display: "flex", gap: 4, marginBottom: 24, flexWrap: "wrap" }} role="group" aria-label="Filter by tier">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button key={f.id} type="button" onClick={() => setFilter(f.id)}
                  className={"cf-filter-pill cf-press" + (active ? " is-active" : "")}
                  aria-pressed={active}>{f.label}</button>
              );
            })}
          </div>

          {["reach", "target", "safety"].map((tier) => {
            if (filter !== "all" && filter !== tier) return null;
            const list = byTier[tier];
            if (list.length === 0) return null;
            const meta = TIER_META[tier];
            return (
              <section key={tier} style={{ marginBottom: 40 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.dot }} />
                  <h2 className="cf-display" style={{ margin: 0, fontSize: "clamp(22px, 3vw, 28px)", letterSpacing: "-0.3px", color: "var(--ink)" }}>{meta.label}</h2>
                  <span className="cf-nums" style={{ fontSize: 13, color: "var(--muted)" }}>({list.length})</span>
                </div>
                <div style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
                  {list.map((s, i) => (
                    <SchoolRow key={s.slug} s={s} odds={(data.admissionOdds || {})[s.slug]} oddsStale={isStaleOdds((data.admissionOdds || {})[s.slug], fingerprint)} last={i === list.length - 1}
                      tracked={trackedFor(s)}
                      onTier={onTier} onTrack={onTrack} onRemove={onRemove} busy={busy} error={error?.slug === s.slug ? error.message : ""} />
                  ))}
                </div>
              </section>
            );
          })}

          {filter !== "all" && byTier[filter].length === 0 ? <div className="cf-empty">No schools in this category yet. Choose All to see your full list.</div> : null}

          {filter === "all" && untiered.length > 0 ? (
            <section style={{ marginBottom: 40 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <h2 className="cf-display" style={{ margin: 0, fontSize: 22, color: "var(--ink)" }}>Not assessed yet</h2>
                <Button size="sm" variant="secondary" disabled={busy} onClick={onAssessAll}
                  title="Sorts each school into reach, target or likely: from your grades and scores where it can, otherwise from an AI estimate of your chances (needs ChatGPT or Grok connected)">
                  Assess all {untiered.length}
                </Button>
              </div>
              {error && error.slug === "__assess" ? <p role="alert" style={{ margin: "0 0 12px", fontSize: 13, color: "var(--error)" }}>{error.message}</p> : null}
              <div style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
                {untiered.map((s, i) => (
                  <SchoolRow key={s.slug} s={s} odds={(data.admissionOdds || {})[s.slug]} oddsStale={isStaleOdds((data.admissionOdds || {})[s.slug], fingerprint)} last={i === untiered.length - 1}
                    tracked={trackedFor(s)}
                    onTier={onTier} onTrack={onTrack} onRemove={onRemove} busy={busy} error={error?.slug === s.slug ? error.message : ""} />
                ))}
              </div>
            </section>
          ) : null}
        </React.Fragment>
      )}
    </div>
  );
}
window.Shortlist = Shortlist;
window.cfOdds = { OddsLine, ChancesPanel, oddsForApp, OddsProgress, OddsPill };
