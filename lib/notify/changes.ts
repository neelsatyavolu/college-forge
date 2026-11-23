import { DECISION_RECEIVED, revealsDecision, type PortalResult } from "../tracker";
import { C, button, callout, escapeHtml, layout } from "./layout";

/**
 * What an automatic check found that's worth an email. Ported from College Apps (worker/src/notify.ts).
 * Forge keeps a short summary of the last check per school (see send.ts) to compare against. Decisions are
 * never named in an email: the student should find out in the portal itself.
 */

/** Why a check failed, as the College Apps portal engine reports it. */
export type CheckErrorCode = "signin" | "mfa" | "sso" | "not_slate" | "unreachable" | "other";

export type CheckOutcome = { ok: true; result: PortalResult } | { ok: false; code: CheckErrorCode; message: string };

/** A stated status that is itself a decision (College Apps worker/src/portal/parse.ts). */
const DECISION_STATUS =
  /^(admitted|not admitted|denied|deny|wait ?list(ed)?|deferred|decided|decision (released|available|made)|complete - decision made|clear admit|(provisional|conditional)(ly)? admit(ted)?|admit\/deny|not csu eligible|offered (mid-year )?admission|appointment offered)\b/i;

/** What a check found, reduced to what's worth comparing. */
export interface CheckState {
  /** The last successful check, or null before the first one. */
  ok: {
    status: string;
    /**
     * What says a decision or update is up: the update link or wording plus any decision status. A change
     * here is a new decision, even when the portal keeps the same "View Update" link.
     */
    update: string;
    received: string[];
    missing: string[];
    decisionDate: string;
    round: string;
  } | null;
  /** Why the latest check failed, for the failures worth telling the student about; "" otherwise. */
  problem: "" | CheckErrorCode;
}

export type Change =
  | { kind: "decision" }
  | { kind: "status"; from: string; to: string }
  | { kind: "received"; items: string[] }
  | { kind: "missing"; items: string[] }
  | { kind: "decisionDate"; date: string }
  | { kind: "round"; from: string; to: string }
  | { kind: "problem"; code: CheckErrorCode; message: string };

/** Failures that need the student (a changed password, two-step verification); a portal being down doesn't. */
const STUDENT_PROBLEMS: CheckErrorCode[] = ["signin", "mfa", "sso", "not_slate"];

export function stateAfter(prev: CheckState | null, outcome: CheckOutcome): CheckState {
  if (!outcome.ok) {
    // A portal that didn't answer says nothing new; keep what we knew.
    if (!STUDENT_PROBLEMS.includes(outcome.code)) return prev ?? { ok: null, problem: "" };
    return { ok: prev?.ok ?? null, problem: outcome.code };
  }
  const s = outcome.result;
  const was = prev?.ok;
  const required = s.checklist.filter((c) => !c.optional);
  // A tab that didn't load leaves a field empty; keep the last value so the next good check isn't "new".
  const listed = required.length > 0 || !was;
  const decision = [s.update, decisionStatus(s.statusText)].filter(Boolean).join(" | ");
  return {
    ok: {
      status: s.statusText || was?.status || "",
      update: decision || was?.update || "",
      received: listed ? required.filter((c) => c.done).map((c) => c.item) : was!.received,
      missing: listed ? required.filter((c) => !c.done).map((c) => c.item) : was!.missing,
      decisionDate: s.decisionDate || was?.decisionDate || "",
      round: s.round || was?.round || "",
    },
    problem: "",
  };
}

const decisionStatus = (status: string) => (DECISION_STATUS.test(status.trim()) || revealsDecision(status) ? status.trim() : "");
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const added = (before: string[], after: string[]) => {
  const had = new Set(before.map(norm));
  return after.filter((x) => !had.has(norm(x)));
};

/** What's new between two checks of the same school. The first check only sets the baseline, unless a decision is already up. */
export function changesBetween(prev: CheckState | null, next: CheckState, message = ""): Change[] {
  if (next.problem) {
    return prev?.problem === next.problem ? [] : [{ kind: "problem", code: next.problem, message }];
  }
  const now = next.ok;
  if (!now) return [];
  const was = prev?.ok;
  if (!was) return now.update ? [{ kind: "decision" }] : [];

  const out: Change[] = [];
  const decision = !!now.update && norm(now.update) !== norm(was.update);
  if (decision) out.push({ kind: "decision" });
  // A status that is itself a decision is covered (without naming it) by the decision above, and an
  // earlier decision isn't named when the status moves on from it.
  if (now.status && norm(now.status) !== norm(was.status) && !decisionStatus(now.status)) {
    out.push({ kind: "status", from: decisionStatus(was.status) ? "" : was.status, to: now.status });
  }
  // Once a decision is up, the checklist and round can give it away ("Enrollment Deposit" now missing, or
  // Early Action moving to Regular Decision), so they wait for the student to read the portal.
  const posted = !!now.update;
  const shown = (list: string[]) => (posted ? [] : list.filter((i) => !revealsDecision(i)));
  const received = shown(added(was.received, now.received));
  if (received.length) out.push({ kind: "received", items: received });
  const missing = shown(added(was.missing, now.missing));
  if (missing.length) out.push({ kind: "missing", items: missing });
  if (now.decisionDate && now.decisionDate !== was.decisionDate) out.push({ kind: "decisionDate", date: now.decisionDate });
  if (!posted && now.round && was.round && now.round !== was.round) out.push({ kind: "round", from: was.round, to: now.round });
  return out;
}

const ROUND_NAMES: Record<string, string> = {
  ED: "Early Decision",
  ED2: "Early Decision II",
  EA: "Early Action",
  REA: "Restrictive Early Action",
  RD: "Regular Decision",
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return m && d ? `${MONTHS[m - 1]} ${d}, ${y}` : iso;
}

function line(change: Change): string {
  switch (change.kind) {
    case "decision":
      return `${DECISION_RECEIVED}. Open your portal to see it.`;
    case "status":
      return change.from ? `Status changed from "${change.from}" to "${change.to}".` : `Status: "${change.to}".`;
    case "received":
      return `Received: ${change.items.join(", ")}.`;
    case "missing":
      return `Now listed as missing: ${change.items.join(", ")}.`;
    case "decisionDate":
      return `Decision date: ${longDate(change.date)}.`;
    case "round":
      return `Your application moved from ${ROUND_NAMES[change.from] ?? change.from} to ${ROUND_NAMES[change.to] ?? change.to}.`;
    case "problem":
      // PortalError messages are already written for the student.
      return change.message || "We couldn't sign in to your portal. Update the saved login so checks can continue.";
  }
}

/**
 * One short line for a lock-screen notification. It says no more than the email subject does: no status
 * wording, checklist items or dates, which a phone shows to anyone nearby.
 */
export function pushBody(changes: Change[]): string {
  if (changes.some((c) => c.kind === "decision")) return `${DECISION_RECEIVED}. Open your portal to see it.`;
  if (changes.length && changes.every((c) => c.kind === "problem")) return "We couldn't check this portal. Update the saved login in Forge.";
  if (changes.some((c) => c.kind === "status")) return "Your application status changed.";
  if (changes.some((c) => c.kind === "missing")) return "Something new is listed as missing.";
  return "New update in your portal.";
}

export interface Email {
  subject: string;
  text: string;
  html: string;
}

export interface EmailExtras {
  /** An absolute URL to the school's logo (PNG; most email clients don't show SVG). */
  logo?: string;
  /** The school's portal, for the button when a decision is up. */
  portalUrl?: string;
  /** One click turns these emails off. */
  unsubscribeUrl: string;
}

const pill = (label: string, fg: string, bg: string) =>
  `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${bg};color:${fg};font-size:13px;font-weight:600;line-height:1.3">${escapeHtml(label)}</span>`;

const items = (list: string[], mark: string, color: string) =>
  list.map((i) => `<div style="padding:2px 0"><span style="color:${color};font-weight:700;padding-right:8px">${mark}</span>${escapeHtml(i)}</div>`).join("");

/** One labeled fact in the card, or a callout for the changes that need the student. */
function block(change: Change): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:14px 0;border-top:1px solid ${C.lineSoft}"><div style="font-size:12px;font-weight:600;color:${C.muted};padding-bottom:6px">${label}</div><div style="font-size:15px;line-height:1.5;color:${C.ink}">${value}</div></td></tr>`;
  const arrow = `<span style="color:${C.muted};padding:0 6px">&rarr;</span>`;
  switch (change.kind) {
    case "decision":
      return `<tr><td style="padding:0 0 16px">${callout(DECISION_RECEIVED, "Open your portal to see it.", "waiting")}</td></tr>`;
    case "problem":
      return `<tr><td style="padding:0 0 16px">${callout("We couldn't check this portal", line(change), "hold")}</td></tr>`;
    case "status":
      return row("Status", `${change.from ? `<span style="color:${C.muted};text-decoration:line-through">${escapeHtml(change.from)}</span>${arrow}` : ""}${pill(change.to, C.workingFg, C.workingBg)}`);
    case "received":
      return row("Received", items(change.items, "&#10003;", C.doneFg));
    case "missing":
      return row("Now missing", items(change.items, "&#9675;", C.holdFg));
    case "decisionDate":
      return row("Decision date", `<strong>${escapeHtml(longDate(change.date))}</strong>`);
    case "round":
      return row("Round", `${escapeHtml(ROUND_NAMES[change.from] ?? change.from)}${arrow}<strong>${escapeHtml(ROUND_NAMES[change.to] ?? change.to)}</strong>`);
  }
}

function schoolHeader(school: string, kicker: string, logo?: string): string {
  const tile = logo
    ? `<td width="56" style="padding-right:14px;vertical-align:middle"><img src="${escapeHtml(logo)}" width="44" height="44" alt="" style="display:block;border:1px solid ${C.line};border-radius:8px;background:#ffffff;padding:4px;object-fit:contain"></td>`
    : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px"><tr>${tile}<td style="vertical-align:middle"><div style="font-size:13px;font-weight:600;color:${C.accent};padding-bottom:2px">${escapeHtml(kicker)}</div><div style="font-size:21px;font-weight:700;line-height:1.25;letter-spacing:-0.01em;color:${C.ink}">${escapeHtml(school)}</div></td></tr></table>`;
}

export function composeEmail(school: string, changes: Change[], appUrl: string, extras: EmailExtras): Email {
  const decision = changes.some((c) => c.kind === "decision");
  const problem = changes.every((c) => c.kind === "problem");
  const subject = decision
    ? `${school}: ${DECISION_RECEIVED.toLowerCase()}`
    : problem
      ? `We couldn't check your ${school} portal`
      : `${school}: your application status changed`;
  const lines = changes.map(line);
  const off = extras.unsubscribeUrl;
  const host = new URL(appUrl).host;
  const text = `${school}\n\n${lines.map((l) => `- ${l}`).join("\n")}\n\nSee all your schools: ${appUrl}\n\nYou get these emails because automatic checks are on in Forge. Turn them off: ${off}\n\nForge · ${host}`;

  const kicker = decision ? "New in your portal" : problem ? "Needs your attention" : "Application update";
  const cta =
    decision && extras.portalUrl
      ? `${button("Open your portal", extras.portalUrl)}<div style="padding-top:14px;font-size:14px"><a href="${escapeHtml(appUrl)}" style="color:${C.accent}">See all your schools</a></div>`
      : button(problem ? "Update the login" : "See all your schools", appUrl);
  const body = `${schoolHeader(school, kicker, extras.logo)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${changes.map(block).join("")}</table><div style="padding-top:24px">${cta}</div>`;
  const html = layout({
    preheader: lines[0] ?? "",
    body,
    footer: `You get these emails because automatic checks are on in Forge. <a href="${escapeHtml(off)}" style="color:${C.muted}">Turn them off</a>.`,
    appUrl,
  });
  return { subject, text, html };
}
