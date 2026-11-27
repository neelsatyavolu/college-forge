import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

/**
 * Decision letters: what a portal's letter says (outcome and merit awards), and making its HTML safe to keep.
 * Pure helpers; storage is in lib/decision-letters.ts. Letter content is untrusted school (or attacker) HTML.
 */

export type LetterResult = "admitted" | "denied" | "waitlisted" | "deferred" | "";
export type LetterKind = "html" | "pdf" | "text";

export interface LetterAward {
  name: string;
  /** "$25,000" or "Full tuition"; "" when the letter names an award without an amount. */
  amount: string;
  /** "per year", "over four years", ... or "". */
  period: string;
}

/** A letter as the College Apps Worker sends it with a snapshot (all fields optional, untrusted). */
export interface IncomingLetter {
  url?: string;
  text?: string;
  html?: string;
  pdfBase64?: string;
  contentType?: string;
}

/** A letter after validation: what gets sealed and stored. */
export interface CleanLetter {
  kind: LetterKind;
  text: string;
  html?: string;
  pdfBase64?: string;
}

export const LETTER_LIMITS = { text: 50_000, html: 300_000, pdfBytes: 5 * 1024 * 1024 } as const;

// ── Outcome ────────────────────────────────────────────────────────────────

const NOT = String.raw`(?<!(?:unable to|not able to|cannot|can ?not|not) )`;
/** A waitlist offer, checked before denials: a waitlist letter usually also says "unable to offer you admission". */
const WAITLIST_OFFER = new RegExp(
  String.raw`\b(${NOT}offer(?:ing)? you a (?:place|position|spot) on|placed (?:you )?on|place you on|been placed on) (?:the|our) wait ?list|\bhave been wait ?listed\b|\bwait ?list(?:ed)? (?:offer|status)\b`,
  "i",
);
/** Denial wording about admission itself: "unable to offer you a scholarship" in an admit letter isn't one. */
const DENIED =
  /\b(not admitted|not accepted|not offered\b(?! (a |the )?(scholarship|award|grant|housing))|(unable|not able) to offer you (admission|a place|a spot|a position|acceptance)|cannot offer you (admission|a place|a spot|a position)|denied|deny|rejected|regret[^.]{0,80}\b(admission|offer you a place)|not csu eligible)\b/i;
const WAITLISTED = /\bwait ?list(ed)?\b/i;
// Strict, because an admit letter can mention deferring enrollment.
const DEFERRED =
  /\b(deferred(?! (enrollment|admission|entry|matriculation))|deferral|defer(red)? (your application|you) to|decision to defer|reconsidered (with|in|during) (the )?regular decision|moved to (the )?regular decision|continue to consider your application)\b/i;
const ADMITTED = new RegExp(
  String.raw`\b(?<!not )(admit|admitted|clear admit|${NOT}offer(ed)? (you )?admission|pleased to offer you|welcome to the class of|you have been accepted|been accepted (to|into|for admission))\b`,
  "i",
);
/** An admit off the waitlist names the waitlist too. */
const ADMIT_FROM_WAITLIST = /\b(admi(t|tted|ssion)|offer(ed)? you (a place|admission))\b[^.]{0,60}\bfrom (the|our) wait ?list\b/i;

/**
 * The outcome a letter or a portal status names, or "" when it names none clearly. Negative phrases first;
 * a letter that reads both as an admit and as something else is unclear, so nothing is recorded from it.
 */
export function classifyOutcome(text: string): LetterResult {
  const t = String(text ?? "").replace(/\s+/g, " ").slice(0, LETTER_LIMITS.text);
  if (!t.trim()) return "";
  if (ADMIT_FROM_WAITLIST.test(t)) return "admitted";
  const other: LetterResult = WAITLIST_OFFER.test(t)
    ? "waitlisted"
    : DENIED.test(t)
      ? "denied"
      : WAITLISTED.test(t)
        ? "waitlisted"
        : DEFERRED.test(t)
          ? "deferred"
          : "";
  const admit = ADMITTED.test(t);
  if (other && admit) return "";
  return other || (admit ? "admitted" : "");
}

// ── Merit awards ───────────────────────────────────────────────────────────

const AWARD_WORD = /\b(scholarship|award|grant|fellowship)\b/i;
/** Need-based aid packages and estimates aren't merit awards. */
const NEED_BASED = /\b(estimated|estimate|net price|need[- ]based|financial aid (package|offer|award)|aid package|pell|cal grant|federal|loan|work[- ]study|student aid index|expected family|efc|fafsa|css profile)\b/i;
const AMOUNT = /\$\s?\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\$\s?\d{3,6}(?:\.\d{2})?|\bfull[- ](?:tuition|ride)\b/i;
const NAME = /((?:[A-Z][\w'’.&-]*\s+){0,6}(?:Scholarship|Award|Grant|Fellowship))\b/;
const AFFIRMED = /\b(award(ed|s)?|receive|offer(ed|ing)?|selected|recipient|granted|pleased|congratulat\w*|named)\b/i;
const NOT_AWARDED = /\b(apply|application for|eligible|consider(ed|ation)|may|might|could|not selected|unable|not been selected|nominat\w*|compete)\b/i;
const PERIOD = /\b(per (?:academic )?year|per semester|each year|annually|a year|over (?:four|4) years|for (?:four|4) years|renewable)\b/i;

/** Merit scholarships, grants and fellowships a letter offers, with need-based estimates left out. At most 5. */
export function findAwards(text: string): LetterAward[] {
  const t = String(text ?? "").replace(/\s+/g, " ").slice(0, LETTER_LIMITS.text);
  const sentences = t.split(/(?<=[.!?])\s+/);
  const out: LetterAward[] = [];
  for (const s of sentences) {
    if (!AWARD_WORD.test(s) || NEED_BASED.test(s)) continue;
    const amount = s.match(AMOUNT)?.[0] ?? "";
    const name = (s.match(NAME)?.[1] ?? "").trim();
    if (!amount && !name) continue;
    // Only an award made to the student: not an invitation to apply or a "not selected".
    if (!AFFIRMED.test(s) || NOT_AWARDED.test(s)) continue;
    const award: LetterAward = {
      name: (name || "Merit scholarship").slice(0, 120),
      amount: /^full/i.test(amount) ? `Full ${amount.split(/[- ]/)[1]!.toLowerCase()}` : amount.replace(/\s/g, ""),
      period: (s.match(PERIOD)?.[0] ?? "").toLowerCase(),
    };
    if (!out.some((a) => a.name === award.name && a.amount === award.amount)) out.push(award);
    if (out.length >= 5) break;
  }
  return out;
}

// ── HTML ───────────────────────────────────────────────────────────────────

const DROP = "script, style, noscript, iframe, frame, frameset, object, embed, applet, form, input, button, select, textarea, link, meta, base, svg, math, template, video, audio, source, track, canvas, portal";
const KEEP_TAGS = new Set([
  "a", "abbr", "b", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup", "dd", "div", "dl", "dt", "em", "font", "h1", "h2", "h3",
  "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "s", "small", "span", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th",
  "thead", "tr", "u", "ul",
]);
const KEEP_ATTRS = new Set(["href", "src", "alt", "title", "width", "height", "align", "valign", "colspan", "rowspan", "style", "color", "size", "face", "border", "cellpadding", "cellspacing"]);
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

/** Inline styles keep layout but lose anything that loads or runs (url(), expression(), behaviors, @import). */
function cleanStyle(style: string): string {
  return style
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";")
    .filter((d) => d.trim() && !/\\|url|image|src\s*\(|expression|behavior|-moz-binding|@import|javascript:|position\s*:\s*fixed/i.test(d))
    .join(";")
    .slice(0, 1000);
}

/**
 * Allowlist sanitizer: known formatting tags only, no scripts, styles' remote urls, forms, frames or event
 * handlers, links only to https/mailto, images only as inlined data: URIs. Returns "" if nothing is left.
 */
export function sanitizeLetterHtml(html: string): string {
  const $ = cheerio.load(String(html ?? "").slice(0, LETTER_LIMITS.html * 4));
  $(DROP).remove();
  $("*")
    .contents()
    .filter((_, n) => n.type === "comment" || n.type === "directive")
    .remove();
  // cheerio.load always wraps the document in html/body.
  const root = $("body");
  // Deepest first, so unwrapping a parent never skips a child.
  const all = root.find("*").toArray().reverse();
  for (const el of all) {
    if (el.type !== "tag") continue;
    const tag = el.tagName.toLowerCase();
    const node = $(el);
    if (!KEEP_TAGS.has(tag)) {
      node.replaceWith(node.contents());
      continue;
    }
    for (const [name, value] of Object.entries(el.attribs ?? {})) {
      const n = name.toLowerCase();
      if (!KEEP_ATTRS.has(n)) node.removeAttr(name);
      else if (n === "href" && !/^(https:\/\/|mailto:|#)/i.test(value.trim())) node.removeAttr(name);
      else if (n === "src" && !DATA_IMAGE.test(value.trim())) node.removeAttr(name);
      else if (n === "style") {
        const s = cleanStyle(value);
        if (s) node.attr("style", s);
        else node.removeAttr(name);
      }
    }
    if (tag === "a" && node.attr("href")) node.attr("rel", "noopener noreferrer").attr("target", "_blank");
    if (tag === "img" && !node.attr("src")) node.remove();
  }
  const out = (root.html() ?? "").trim();
  return out.length > LETTER_LIMITS.html || !root.text().trim() ? "" : out;
}

/** Plain text of a letter's HTML, for classifying when the Worker sent no text. */
export function htmlText(html: string): string {
  const $ = cheerio.load(String(html ?? "").slice(0, LETTER_LIMITS.html * 4));
  $(DROP).remove();
  $("br, p, div, tr, li, h1, h2, h3, h4").after(" ");
  return $.root().text().replace(/\s+/g, " ").trim().slice(0, LETTER_LIMITS.text);
}

// ── Validation ─────────────────────────────────────────────────────────────

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Validates a letter from the Worker. A PDF over the cap is dropped rather than failing the check. Null when nothing usable. */
export function cleanLetter(raw: unknown): CleanLetter | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as IncomingLetter;
  const html = typeof r.html === "string" ? sanitizeLetterHtml(r.html) : "";
  const text = (typeof r.text === "string" ? r.text.replace(/\s+/g, " ").trim() : "").slice(0, LETTER_LIMITS.text) || (r.html ? htmlText(r.html) : "");
  const pdf = typeof r.pdfBase64 === "string" ? r.pdfBase64.replace(/\s/g, "") : "";
  const pdfOk = !!pdf && pdf.length <= Math.ceil((LETTER_LIMITS.pdfBytes * 4) / 3) && BASE64.test(pdf) && pdf.startsWith("JVBER"); // "%PDF"
  if (pdfOk) return { kind: "pdf", text, pdfBase64: pdf };
  if (html) return { kind: "html", text, html };
  if (text) return { kind: "text", text };
  return null;
}

/** A stable id for the letter behind one posted decision: never the decision's words themselves. */
export const letterKey = (decisionKey: string): string => createHash("sha256").update(decisionKey).digest("hex").slice(0, 32);
