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
  "Shared UC essays": { bg: "color-mix(in srgb, var(--teal, var(--accent)) 12%, transparent)", color: "var(--ink)" },
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

/** A school name for matching: "University of Michigan--Ann Arbor" and "University of Michigan" line up. */
const schoolKey = (n) => String(n || "").toLowerCase().replace(/\b(the)\b/g, " ").replace(/[–—-]{1,2}|[,.'’()&]/g, " ").replace(/\s+/g, " ").trim();

/**
 * A tracked application's chance estimate: by its own key ("app:<id>"), or the shortlist school it belongs to,
 * matched like the server's trackedFor (slug, catalog id, name, or a name that starts the other).
 */
function oddsForApp(data, app) {
  const oddsMap = (data && data.admissionOdds) || {};
  // The server says where this app's estimate is saved (lib/tracker-service.ts oddsKey); the rest is a fallback.
  if (app.oddsKey && oddsMap[app.oddsKey]) return oddsMap[app.oddsKey];
  if (oddsMap["app:" + app.id]) return oddsMap["app:" + app.id];
  const name = schoolKey(app.name);
  const colleges = ((data && data.colleges) || []).filter((c) => c.slug && oddsMap[c.slug]);
  const listed = colleges.find((c) => c.slug === app.slug || c.slug === app.collegeId)
    || colleges.find((c) => schoolKey(c.name) === name || schoolKey(c.short) === name)
    || colleges.find((c) => { const k = schoolKey(c.name); return k && name && (k.startsWith(name + " ") || name.startsWith(k + " ")); });
  return listed ? oddsMap[listed.slug] : null;
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
  // One button (Progress's header, the shortlist's toolbar); progress, results and a stale warning show in a
  // short line under it, in the page's flow so it never covers what sits below.
  const line = running ? "" : result ? result.text : staleCount ? `${staleCount} of ${estimated.length} estimates predate profile changes.` : "";
  return (
    <span className={"cf-odds-compact" + (compact ? "" : " cf-odds-compact--start")}>
      {running ? <OddsPill frac={frac} text={progress} /> : <Button size="sm" variant="secondary" onClick={run}
        title="The AI reads your profile, essays, each school's supplements and your uploads, starts from each school's published rate for your round, and can move at most threefold from it. A rough guide.">{label}</Button>}
      {line ? <span role="status" aria-live="polite" className="cf-odds-compact__line" style={{ color: result && result.tone === "error" ? "var(--error)" : staleCount && !running && !result ? "var(--warning)" : "var(--muted)" }}>{line}</span> : null}
    </span>
  );
}

// A click on the card's empty area opens the school, like its name; its controls keep their own clicks.
const CARD_CONTROLS = "a, button, select, input, textarea, label, summary, details, [role='button'], [data-card-stay]";
function openFromCard(e, slug) {
  if (e.defaultPrevented || e.button !== 0 || (e.target.closest && e.target.closest(CARD_CONTROLS))) return;
  const picked = window.getSelection && String(window.getSelection());
  if (picked) return;
  window.location.hash = window.cfSchoolDetail.hashFor(slug).slice(1);
}

function SchoolRow({ s, odds, oddsStale, last, tracked, onTier, onTrack, onRemove, busy, error }) {
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const round = window.cfSchoolDetail.chosenRound(s);
  return (
    <div id={"school-" + s.slug} className="cf-short-card" onClick={(e) => openFromCard(e, s.slug)} style={{ display: "block", background: s.priority ? "color-mix(in srgb, var(--coral) 5%, transparent)" : "transparent", borderBottom: last ? "none" : "1px solid var(--hairline)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16, alignItems: "center", padding: "16px 20px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <h3 className="cf-display" style={{ margin: 0, fontSize: 19, lineHeight: 1.3, color: "var(--ink)" }}>
              <a className="cf-short-card__name" href={window.cfSchoolDetail.hashFor(s.slug)}>{s.name || s.short}</a>
            </h3>
            {s.priority ? <Badge variant="coral" uppercase>Priority</Badge> : null}
            {isUcCampus(s) ? <Badge variant="teal" uppercase>UC Application</Badge> : null}
            {window.cfEssayArchetypes.isCsuCampus(s) ? <Badge variant="teal" uppercase>Cal State Apply</Badge> : null}
          </div>
          <div style={{ fontSize: 13, color: "var(--body)", marginBottom: 6 }}>
            {s.major || "—"}
            {s.location ? <span style={{ color: "var(--muted-soft)" }}> · {s.location}</span> : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <SuppPill load={window.cfEssayArchetypes.isCsuCampus(s) || s.supplementsNeeded === "no" ? "No supps" : isUcCampus(s) ? "Shared UC essays" : s.supp} />
            {s.admit ? <span className="cf-nums" style={{ fontSize: 12, color: "var(--muted)" }}>Overall admission rate: {s.admit}</span> : null}
            {s.netPriceForYou ? <span className="cf-nums" style={{ fontSize: 12, color: "var(--muted)" }}>Your likely cost: {s.netPriceForYou}</span> : null}
          </div>
          <OddsLine odds={odds} stale={oddsStale} />
          {s.research && (s.research.facts || []).length ? <a className="cf-short-research cf-nums" href={window.cfSchoolDetail.hashFor(s.slug)}>Research: {s.research.facts.length} sourced facts on its page →</a> : null}
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
            <span className="cf-short-round cf-nums" data-chosen={round ? "true" : "false"}>{window.cfSchoolDetail.roundText(s)}</span>
            {!confirmRemove ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove school</Button> : null}
          </div>
          {confirmRemove ? <div data-card-stay="" style={{ marginTop: 12, padding: 12, background: "var(--surface-soft)", borderRadius: "var(--radius-sm)" }}>
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
        {/* A verdict that only names a tier was copied from the tier when the school was added and goes
            stale when the student changes the Tier menu above; only other labels are worth showing. */}
        {s.verdict && !/^(reach|target|safety|likely)$/i.test(String(s.verdict.label || "").trim()) ? <div><VerdictBadge tone={s.verdict.tone}>{s.verdict.label}</VerdictBadge></div> : null}
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

/** Soft app count: all UC campuses share one UC Application slot, and all Cal States one Cal State Apply. */
function applicationSlotCount(colleges) {
  return window.cfEssayArchetypes.applicationCount(colleges);
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

/** What a previewed balance would do to the list, by name. */
function previewSummary(preview) {
  if (!preview.added.length && !preview.removed.length) return "Your list wouldn’t change: every school on it is one you or the copilot added, or it already fits.";
  return [preview.added.length ? `Adds ${preview.added.join(", ")}.` : "", preview.removed.length ? `Removes ${preview.removed.join(", ")}.` : ""].filter(Boolean).join(" ");
}

/**
 * List balance and chances in one row above the schools. "More ambitious" and "Safer" only preview the mix
 * (what would be added and removed, by name); "Rebalance list" saves it. Warnings open a second line.
 */
function ListTools({ ambition, preview, warnings, gaps, busy, error, onShift, onCancel, onRebalance, data, onWorkspaceChange }) {
  const shown = preview ? preview.ambition : ambition;
  const step = AMBITION_STEPS.indexOf(shown);
  return (
    <section aria-label="List balance and chances" className="cf-short-tools">
      <div className="cf-short-tools__row">
        <span className="cf-short-tools__label">Balance: <b>{AMBITION_LABEL[shown]}</b>{preview ? " (preview)" : ""}</span>
        <span className="cf-short-tools__actions">
          <Button variant="secondary" size="sm" disabled={busy || step >= AMBITION_STEPS.length - 1} onClick={() => onShift(1)}
            title="Preview a mix with more reaches. Nothing changes until you press Rebalance list.">More ambitious</Button>
          <Button variant="secondary" size="sm" disabled={busy || step <= 0} onClick={() => onShift(-1)}
            title="Preview a mix with more likely schools. Nothing changes until you press Rebalance list.">Safer</Button>
          <Button size="sm" disabled={busy} onClick={onRebalance}
            title="Swaps only the schools Forge picked for you. Schools you added and priority schools stay.">Rebalance list</Button>
          {preview ? <button type="button" className="cf-link-btn" disabled={busy} onClick={onCancel}>Cancel</button> : null}
        </span>
        <span className="cf-short-tools__chances"><ChancesPanel data={data} onWorkspaceChange={onWorkspaceChange} /></span>
      </div>
      {preview ? <p className="cf-short-tools__preview" role="status">{AMBITION_LABEL[preview.ambition]}: {previewSummary(preview)} Press Rebalance list to save it.</p> : null}
      {warnings.length || gaps.length ? (
        <ul className="cf-short-tools__warnings">
          {warnings.map((w) => <li key={w}>{w}</li>)}
          {gaps.map((g) => <li key={g.tier}>Rebalancing could not find {g.missing} more {GAP_WORD[g.tier] || g.tier} {g.missing === 1 ? "school" : "schools"} that fit your preferences. Add your own from Explore.</li>)}
        </ul>
      ) : null}
      {error ? <p role="alert" className="cf-short-tools__error">{error}</p> : null}
    </section>
  );
}

function Shortlist({ data, tracker, detailSlug, onTrackerChange, onAsk, onWorkspaceChange }) {
  const [filter, setFilter] = React.useState("all");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [notice, setNotice] = React.useState("");
  // A previewed balance: { ambition, added, removed }, saved only by "Rebalance list".
  const [preview, setPreview] = React.useState(null);
  // Back from a school's page returns to where the list was scrolled.
  const listScroll = React.useRef(0);
  const lastOpened = React.useRef(null);
  React.useEffect(() => {
    if (detailSlug) { lastOpened.current = detailSlug; return undefined; }
    window.scrollTo(0, listScroll.current);
    if (lastOpened.current) {
      const link = document.querySelector(`a[href="${CSS.escape(window.cfSchoolDetail.hashFor(lastOpened.current))}"]`);
      if (link) link.focus({ preventScroll: true });
      lastOpened.current = null;
    }
    const remember = () => { listScroll.current = window.scrollY; };
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, [detailSlug]);
  React.useEffect(() => { setNotice(""); setError(null); }, [detailSlug]);
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
    if (summary) { setPreview(null); setNotice((nextAmbition ? `List balance set to ${AMBITION_LABEL[nextAmbition].toLowerCase()}. ` : "") + summary); }
  };
  // Shows what a rebalance at the next balance would add and remove; nothing is saved until "Rebalance list".
  const onShift = async (dir) => {
    const from = preview ? preview.ambition : ambition;
    const next = AMBITION_STEPS[Math.max(0, Math.min(AMBITION_STEPS.length - 1, AMBITION_STEPS.indexOf(from) + dir))];
    if (next === ambition) { setPreview(null); return; }
    setBusy(true); setError(null); setNotice("");
    try {
      const j = await window.cfApi.postAction("rebalance-preview", { ambition: next });
      setPreview({ ambition: next, added: j.added || [], removed: j.removed || [] });
    } catch (e) {
      setError({ slug: "__balance", message: e.message || "Couldn’t preview that balance. Try again." });
    } finally { setBusy(false); }
  };
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

  if (detailSlug) {
    const open = data.colleges.find((c) => c.slug === detailSlug);
    if (!open) {
      return (
        <div className="cf-page cf-sd">
          <a className="cf-sd-back" href="#shortlist">← Your shortlist</a>
          <div className="cf-empty">That school isn’t on your list. It may have been removed or renamed.</div>
        </div>
      );
    }
    const openOdds = (data.admissionOdds || {})[open.slug];
    return <window.SchoolDetail college={open} data={data} tracked={trackedFor(open)} odds={openOdds} oddsStale={isStaleOdds(openOdds, fingerprint)}
      onTrack={onTrack} busy={busy} notice={error && error.slug === open.slug ? error.message : notice} />;
  }

  return (
    <div className="cf-page">
      <header className="cf-page-header">
        <div>
          <h1 className="cf-page-title">Your shortlist</h1>
          <p className="cf-page-lede">Schools here also show on Progress as Not started.</p>
        </div>
        <div className="cf-row-actions">
          {data.colleges.length > 0 ? <a className="cf-link-btn" href="#list" style={{ display: "inline-flex", alignItems: "center" }}>See them ranked →</a> : null}
          <Button variant="secondary" size="sm" onClick={onAsk}>Ask copilot to adjust ✱</Button>
        </div>
      </header>

      <div role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", marginBottom: notice || busy ? 16 : 0 }}>{busy ? notice || "Saving change…" : notice}</div>

      {data.colleges.length > 0 ? (
        <div className="cf-grid-short-stats cf-short-stats" style={{ marginBottom: 20 }}>
          {[
            ["Campuses", data.colleges.length],
            ["App slots", appSlots, ucCount > 1 ? "UC campuses share one UC Application, so they count as one app slot." : ""],
            ["Reaches", byTier.reach.length],
            ["Targets", byTier.target.length],
            ["Likely", byTier.safety.length],
          ].map(([l, v, title]) => (
            <div key={l} title={title || undefined}>
              <div className="cf-display cf-nums" style={{ fontSize: 32, lineHeight: 1, letterSpacing: "-0.5px", color: "var(--ink)" }}>{v}</div>
              <div style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "1.5px", color: "var(--muted)", marginTop: 4 }}>{l}</div>
            </div>
          ))}
        </div>
      ) : null}

      {data.colleges.length > 0 ? (
        <ListTools ambition={ambition} preview={preview} warnings={warnings} gaps={shownGaps} busy={busy}
          error={error && error.slug === "__balance" ? error.message : ""} onShift={onShift} onCancel={() => setPreview(null)}
          onRebalance={() => rebalance(preview ? preview.ambition : null)} data={data} onWorkspaceChange={onWorkspaceChange} />
      ) : null}

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
      <p className="cf-help"><a href="#scattergrams">Import past results from Maia Learning (if your school uses it) →</a></p>
    </div>
  );
}
window.Shortlist = Shortlist;
window.cfOdds = { OddsLine, ChancesPanel, oddsForApp, OddsProgress, OddsPill };
