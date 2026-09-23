/**
 * Heuristic extraction of supplemental essay prompts from an official
 * admissions page. No AI: the page is flattened into ordered text blocks
 * (headings with levels, paragraphs, list items, cells), then prompts are
 * recognized by question/imperative wording plus a word/character limit
 * found in the block, an adjacent "250 words" line, its heading, or an intro
 * line such as "Please respond to each question in 50 words or fewer."
 * Section state (skipped archives, intro limits, choose-one groups) lasts
 * until the next heading at the same or a higher level.
 */

import * as cheerio from "cheerio";

const NOISE =
  "script,style,noscript,svg,nav,header,footer,form,iframe,aside,template,[role=navigation],[role=banner],[role=contentinfo]";
const BLOCK_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote", "td", "th", "dt", "dd", "summary", "div"];
const BLOCK_SELECTOR = BLOCK_TAGS.join(",");

/** Level for headings that aren't h1–h6 (accordion summaries, bold lines). */
const MINOR_HEADING = 7;
/** Section level used when text appears before any heading. */
const NO_SECTION = 6;

const MIN_LIMIT = 10;
const MAX_LIMIT = 5000;
const MIN_PROMPT_CHARS = 12;
const MAX_PROMPT_CHARS = 2500;
const MAX_LABEL_CHARS = 90;
const MIN_OPTION_CHARS = 30;
const MAX_LIMIT_LINE_CHARS = 40;

const PROMPT_START =
  /^(?:\d+[.)]\s*)?(?:describe|tell us|explain|share|reflect|discuss|why|what|how|who|which|when|where|if you|imagine|please|choose|select|write|consider|think|elaborate|briefly|list|in (?:a|an|one|the|your|what|\d)|we |you |our |at |as |beyond|there|from|every|many|some|using)/i;
const ESSAY_CONTEXT = /\b(respond|response|answer|essay|question|prompt|short|write|writing|words?|characters?)\b/i;
/** Intro lines that describe the prompts after them rather than being one. */
const INTRO_WORDS = /\b(each|following|(?:prompts?|questions?) below|these (?:prompts|questions))\b/i;
const CHOOSE_ONE =
  /\b(?:choose|select|pick|respond to|answer|address)\s+(?:only\s+)?(?:one|1|a single)\b|\bone of the following\b/i;
const OPTIONAL = /\boptional\b/i;
const TRANSFER = /\btransfer(?:ring|red|s)?\b|\bgraduate (?:applicants?|students?|programs?)\b/i;
/** Application logistics that end a choose-one list. */
const INSTRUCTION = /\b(must|submit(?:ted)?|upload|recommendations?|letters? of|deadlines?|transcripts?|portal|fee)\b/i;
/** Process notes that are never prompts ("Please allow 3-4 business days..."). */
const LOGISTICS = /\b(business days|deadlines?|transcripts?|portal|application fee|fee waiver|letters? of recommendation)\b/i;
/** Sections to skip: archives, samples, and non-first-year application tracks. */
const SKIP_SECTION = /\b(past|previous|prior|archived?|sample|example|last year'?s?|questbridge|transfer)\b/i;
/** Headings that mark what follows as a prompt even without a stated limit. */
const PROMPT_HEADING =
  /\b(?:question|prompt|essay)\s*#?\s*\d+\b|\b(?:essay|question|prompt)s?\b.*\brequired\b|\brequired\b.*\b(?:essay|question|prompt)s?\b/i;
/** Credit lines under prompts: "Inspired by Jane Doe, Class of 2026". */
const ATTRIBUTION = /^(?:inspired by|submitted by|by\s|[—–-]\s)|\b(?:class of \d{4}|AB'?\d{2})\s*$/i;
const LIMIT_PHRASE =
  /[([]?\s*(?:(?:please\s+)?(?:respond|answer|limit(?:ed)?|max(?:imum)?|up to|no more than|fewer than|less than|in|of|to|under)\b[^()\d]{0,30})?\d[\d,]*\s*(?:(?:-|–|to)\s*\d[\d,]*\s*)?[\s-]*(?:words?|characters?|chars)\b[^)\]]{0,20}[)\]]?/gi;
const CYCLE = /\b(20\d\d)\s*[-–—/]\s*(?:20)?(\d\d)\b/;

function clean(text) {
  return text.replace(/\u00a0/g, " ").replace(/[ \t\r\n]+/g, " ").trim();
}

/** Parse the first word/character limit in text. */
export function parseLimit(text) {
  const t = text.replace(/(\d),(\d{3})/g, "$1$2");
  const range = t.match(/(\d{1,4})\s*(?:-|–|to)\s*(\d{1,4})[\s-]*(words?|characters?|chars)\b/i);
  const single = t.match(/(\d{1,4})[\s-]*(words?|characters?|chars)\b/i);
  const m = range ? { n: Number(range[2]), unit: range[3] } : single ? { n: Number(single[1]), unit: single[2] } : null;
  if (!m || m.n < MIN_LIMIT || m.n > MAX_LIMIT) return null;
  return { limit: m.n, unit: /^w/i.test(m.unit) ? "words" : "characters" };
}

/** True for lines that only state a limit ("250 words", "(Maximum 150 words)"). */
export function isLimitOnly(text) {
  if (!parseLimit(text)) return false;
  return text.replace(LIMIT_PHRASE, "").replace(/[^a-z]/gi, "").length < MIN_PROMPT_CHARS;
}

/** True when text reads like a prompt rather than navigation or FAQ copy. */
export function looksLikePrompt(text) {
  if (text.length < MIN_PROMPT_CHARS || text.length > MAX_PROMPT_CHARS) return false;
  return text.includes("?") || PROMPT_START.test(text);
}

function headingLevel($, el, text) {
  const tag = el.tagName.toLowerCase();
  const h = tag.match(/^h([1-6])$/);
  if (h) return Number(h[1]);
  if (tag === "summary" || tag === "dt" || tag === "th") return MINOR_HEADING;
  const bold = clean($(el).find("strong,b").text());
  return text.length <= MAX_LABEL_CHARS && bold === text && !text.includes("?") ? MINOR_HEADING : 0;
}

/** Flatten HTML into ordered text blocks: { text, level } (level 0 = body text). */
export function htmlToBlocks(html) {
  const $ = cheerio.load(html);
  $(NOISE).remove();
  const main = $("main, [role=main], article").first();
  const root = main.length ? main : $("body");
  const blocks = [];
  root.find(BLOCK_SELECTOR).each((_, el) => {
    const node = $(el);
    if (!node.find(BLOCK_SELECTOR).length) {
      const text = clean(node.text());
      if (text) blocks.push({ text, level: headingLevel($, el, text) });
      return;
    }
    // Containers: keep their own text (text nodes and inline tags) so a
    // prompt written directly inside a <div> beside a nested <p> isn't lost.
    const own = clean(
      node
        .contents()
        .filter((_, c) => c.type === "text" || (c.type === "tag" && !$(c).is(BLOCK_SELECTOR) && !$(c).find(BLOCK_SELECTOR).length))
        .text()
    );
    if (own.length >= MIN_PROMPT_CHARS) blocks.push({ text: own, level: 0 });
  });
  return { blocks, title: clean($("title").first().text()) };
}

function formatLabel(headingText, index) {
  const text = (headingText || "").replace(/[:\s]+$/, "");
  // Headings that state a limit are instructions ("Please respond in 100 words"), not names.
  if (text && text.length <= MAX_LABEL_CHARS && !parseLimit(text)) return text;
  return `Prompt ${index}`;
}

/**
 * Extract prompts from blocks. Returns [{ label, prompt, limit, unit, required, options }];
 * limit is null only for prompts under an explicit "Question 1 (Required)"-style heading.
 */
export function extractFromBlocks(blocks) {
  const prompts = [];
  let heading = null; // { text, level, limit, explicit }
  let skipLevel = null; // inside a skipped section opened at this level
  let intro = null; // { limit, level, optional }
  let group = null; // open choose-one prompt collecting options

  const closeGroup = () => {
    if (group?.options.length) {
      const { level, ...prompt } = group;
      prompts.push({ ...prompt, prompt: prompt.prompt || "Choose one of the following prompts." });
    }
    group = null;
  };
  const sectionLevel = () => heading?.level ?? NO_SECTION;
  const openGroup = (fields) => {
    closeGroup();
    group = { label: formatLabel(heading?.text, prompts.length + 1), prompt: "", options: [], ...fields };
  };

  for (let i = 0; i < blocks.length; i++) {
    const { text, level } = blocks[i];

    if (level > 0) {
      if (skipLevel !== null && level > skipLevel) continue;
      skipLevel = SKIP_SECTION.test(text) ? level : null;
      if (group && level <= group.level) closeGroup();
      if (intro && level <= intro.level) intro = null;
      if (skipLevel !== null) continue;
      const limit = parseLimit(text);
      heading = { text, level, limit, explicit: PROMPT_HEADING.test(text) && !text.includes("?") };
      if (limit) intro = { limit, level, optional: OPTIONAL.test(text) };
      if (CHOOSE_ONE.test(text)) {
        openGroup({ ...(limit || {}), required: !OPTIONAL.test(text), explicit: heading.explicit, level });
      }
      continue;
    }
    if (skipLevel !== null) continue;

    const own = parseLimit(text);
    const isPrompt = looksLikePrompt(text);

    // Intro lines set a limit (and choose-one mode) for the prompts that follow.
    if (own && ESSAY_CONTEXT.test(text) && !text.includes("?") && (!isPrompt || INTRO_WORDS.test(text))) {
      closeGroup();
      const optional = OPTIONAL.test(text) || OPTIONAL.test(heading?.text || "");
      intro = { limit: own, level: sectionLevel(), optional };
      if (CHOOSE_ONE.test(text)) openGroup({ prompt: text, ...own, required: !optional, level: sectionLevel() });
      continue;
    }
    if (!group && !own && CHOOSE_ONE.test(text) && !text.includes("?")) {
      const limit = intro?.limit || heading?.limit || null;
      openGroup({ prompt: text, ...(limit || {}), required: !OPTIONAL.test(text), explicit: Boolean(heading?.explicit), level: sectionLevel() });
      continue;
    }
    if (group && INSTRUCTION.test(text) && !text.includes("?")) {
      closeGroup();
      continue;
    }
    // Inside a choose-one group any substantial paragraph is an option.
    const groupOption = group && text.length >= MIN_OPTION_CHARS;
    if ((!isPrompt && !groupOption) || isLimitOnly(text) || ATTRIBUTION.test(text)) continue;
    if (LOGISTICS.test(text) && !text.includes("?")) continue;
    // Transfer and graduate prompts often share a page with first-year ones.
    if (TRANSFER.test(text) || TRANSFER.test(heading?.text || "")) continue;

    const next = blocks[i + 1];
    const adjacent = next && next.level === 0 && next.text.length <= MAX_LIMIT_LINE_CHARS ? parseLimit(next.text) : null;
    const limit = own || adjacent || intro?.limit || heading?.limit || null;

    if (group) {
      group.options.push(text);
      if (!group.limit && limit) Object.assign(group, limit);
      continue;
    }
    if (!limit && !heading?.explicit) continue;
    prompts.push({
      label: formatLabel(heading?.text, prompts.length + 1),
      prompt: text,
      limit: limit?.limit ?? null,
      unit: limit?.unit ?? "words",
      required: !(OPTIONAL.test(text) || OPTIONAL.test(heading?.text || "") || intro?.optional),
      options: [],
      explicit: Boolean(heading?.explicit),
    });
  }
  closeGroup();
  return dedupe(prompts.filter((p) => p.limit || p.explicit)).map(({ explicit, ...p }) => ({
    ...p,
    limit: p.limit ?? null,
    unit: p.unit ?? "words",
  }));
}

function dedupe(prompts) {
  const seen = new Set();
  const out = [];
  const labelCounts = new Map();
  for (const p of prompts) {
    const key = `${p.prompt}|${p.options.join("|")}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labelCounts.set(p.label, (labelCounts.get(p.label) || 0) + 1);
    out.push(p);
  }
  // Disambiguate repeated section labels ("Short answers" ×3 → "Short answers 1..3").
  const counters = new Map();
  return out.map((p) => {
    if (labelCounts.get(p.label) < 2) return p;
    const n = (counters.get(p.label) || 0) + 1;
    counters.set(p.label, n);
    return { ...p, label: `${p.label} ${n}` };
  });
}

/** Detect an admissions-cycle label like "2026-27" in page text. */
export function detectCycle(text) {
  const m = text.match(CYCLE);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return end === (start + 1) % 100 ? `${start}-${String(end).padStart(2, "0")}` : null;
}

/** Full page → { title, cycle, prompts }. */
export function extractPrompts(html) {
  const { blocks, title } = htmlToBlocks(html);
  const prompts = extractFromBlocks(blocks);
  const cycle = detectCycle(`${title} ${blocks.slice(0, 40).map((b) => b.text).join(" ")}`);
  return { title, cycle, prompts };
}
