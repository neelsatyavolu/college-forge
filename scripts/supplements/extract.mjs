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
/** Accordion toggles ("<button aria-controls>Transfer Students</button>") title the panel after them. */
const ACCORDION_BUTTON = "button[aria-controls],button[aria-expanded]";
const BLOCK_SELECTOR = [...BLOCK_TAGS, ACCORDION_BUTTON].join(",");

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
/** A <main> holding less than this share of the page text is a title wrapper, not the content. */
const MAIN_SHARE = 0.3;

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
const LOGISTICS =
  /\b(business days|deadlines?|transcripts?|portal|application fee|fee waiver|letters? of recommendation|criminal history)\b/i;
/** Lines about the application itself (blog posts, program notes), never prompts even with a prompt verb. */
const APPLICATION_NOTE =
  /\b(?:today[’']s post|this post|(?:our|the) application (?:opens|will open)|application opens|we accept both|speak with an admissions? counselor|other specific requirements)\b/i;
/** Headings over notes, not prompts: "Instructions". */
const NOTE_HEADING = /^(?:application\s+)?instructions?:?$/i;
/** Accordion titles that arrive as plain text: "Essay Questions for PLME Applicants". */
const SECTION_TITLE = /^(?:(?:essay|short[- ]answer|supplement(?:al)?|writing)\s+(?:questions?|prompts?|essays?)|(?:questions?|prompts?|essays?))\s+for\b/i;
/** Lines that announce a list of prompts: "Four essays are required for all first-year applicants:". */
const LIST_INTRO = /\b(?:essays?|questions?|prompts?|short answers?)\b.*:$/i;
/** "First-Year and Transfer Applicants" covers first-years too. */
const FIRST_YEAR = /\b(?:first[- ]year|freshm[ae]n)\b/i;
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
/** "Class of 2031" or "Fall 2027 applicants" when a page names no "2026-27" range. */
const ENTRY_YEAR = /\b(class of|fall|entering in)\s+(20\d\d)\b/gi;
/** Words that make a block ask for writing; blocks with neither these nor "?" are notes. */
const PROMPT_VERB =
  /\b(?:describ|tell|explain|shar(?:e|ing)\b|reflect|discuss|write\b|elaborat|imagin|choos|select|respond\b|introduc|recount|identify|submit|provide|list\b|pick|convince|design|create|compose|illustrat|highlight|address|consider|think|help us|let us|teach|reveal|complete|finish|propose|envision|detail|comment|speak|talk about|outline|analy[sz]|evaluat|argue|defend)/i;
/** Verbs that ask for an essay, for the line right after an intro ("...based on the following prompt:"). */
const WRITING_VERB = /\b(?:describ|reflect|tell us|share|explain|discuss|write\b|elaborat|imagin)/i;
/** Openers of process notes that do contain a prompt verb ("You can submit your short answers..."). */
const INSTRUCTION_START =
  /^(?:please keep|you (?:can|may|must) (?:also )?submit|submit(?:ting)? your|short answer responses must|you are welcome to use|word limit)/i;
/** "Short Essay 1:", "Short Answer Prompt #1:", "Question 2." — a label written into the prompt line. */
const LABEL_PREFIX = /^((?:short\s+)?(?:essay|question|prompt|answer)(?:\s+(?:prompt|question))?\s*#?\s*\d+)\s*[:.]\s+/i;
/** "Applicants to the School of Engineering are required to..." / "For Applicants to the College of Arts & Sciences: ..." */
const AUDIENCE_LINE =
  /^(?:for\s+)?(?:applicants|students)\s+(?:applying\s+)?(?:to|in|into|interested in)\s+(?:the\s+)?(.{3,80}?)(?:\s+(?:are|must|should|will|may)\b|\s*:\s*)/i;
/** Headings for prompts only some applicants answer (Princeton B.S.E., Rice architecture). */
const AUDIENCE_HEADING = /\bapplicants?\b|\bengineering\b|\barchitecture\b|\bB\.\s?S\.\s?E\b|\bA\.\s?B\.|\b(?:majors?|program|school) only\b/i;
/** Pages where each college or school inside the university has its own essays (Cornell). */
const PER_SCHOOL_PAGE =
  /\bonly the essays?\b.{0,40}\bcorrespond.{0,40}\b(?:college|school)\b|\bessays? (?:vary|differ|depend) (?:by|on) (?:the )?(?:college|school)\b/i;
/** "School-Specific Prompts", "Dual-Degree and Specialized Program Essays": one set per applicant. */
const PROGRAM_SPECIFIC = /\b(?:school|college|program|major)[- ]specific\b|\bdual[- ]degree\b|\bspeciali[sz]ed programs?\b/i;
const SCHOOL_HEADING = /\b(?:college|school|program)\b/i;
/** Headings that name every first-year applicant, not a subgroup. */
const ALL_APPLICANTS = /\b(first[- ]year|freshman|freshmen|all|domestic|international|undergraduate)\b/i;

function clean(text) {
  return text.replace(/\u00a0/g, " ").replace(/[ \t\r\n]+/g, " ").trim();
}

/**
 * Parse the word/character limit in text: the upper end of a range, else the
 * largest stated count ("a 3-word minimum and a 50-word maximum" → 50).
 */
export function parseLimit(text) {
  const t = text.replace(/(\d),(\d{3})/g, "$1$2");
  const range = t.match(/(\d{1,4})\s*(?:-|–|to)\s*(\d{1,4})[\s-]*(words?|characters?|chars)\b/i);
  const singles = [...t.matchAll(/(\d{1,4})[\s-]*(words?|characters?|chars)\b/gi)]
    .map((s) => ({ n: Number(s[1]), unit: s[2] }))
    .filter((s) => s.n >= MIN_LIMIT && s.n <= MAX_LIMIT)
    .sort((a, b) => b.n - a.n);
  const m = range ? { n: Number(range[2]), unit: range[3] } : singles[0] || null;
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
  if (tag === "summary" || tag === "dt" || tag === "th" || tag === "button") return MINOR_HEADING;
  const bold = clean($(el).find("strong,b").text());
  return text.length <= MAX_LABEL_CHARS && bold === text && !text.includes("?") ? MINOR_HEADING : 0;
}

/** Text of a bold run that opens a block and is followed by a line break, else null. */
function leadingBoldHeading($, node) {
  const first = node.contents().filter((_, c) => c.type !== "text" || clean($(c).text())).first();
  if (!first.is("strong,b") || !first.next().is("br")) return null;
  const text = clean(first.text());
  return text && text.length <= MAX_LABEL_CHARS && !text.includes("?") ? text : null;
}

/** Flatten HTML into ordered text blocks: { text, level } (level 0 = body text). */
export function htmlToBlocks(html) {
  const $ = cheerio.load(html);
  $(NOISE).remove();
  // The fullest main/article region; some sites wrap only the page title in <main>.
  const body = $("body");
  const main = $("main, [role=main], article")
    .toArray()
    .map((el) => $(el))
    .sort((a, b) => b.text().length - a.text().length)[0];
  const root = main && main.text().length >= body.text().length * MAIN_SHARE ? main : body;
  const blocks = [];
  root.find(BLOCK_SELECTOR).each((_, el) => {
    const node = $(el);
    if (!node.find(BLOCK_SELECTOR).length) {
      const text = clean(node.text());
      const lead = leadingBoldHeading($, node);
      if (lead && text.length > lead.length) {
        // "<p><strong>College of Human Ecology</strong><br>The College..." is a heading and a paragraph.
        blocks.push({ text: lead, level: MINOR_HEADING });
        blocks.push({ text: clean(text.slice(text.indexOf(lead) + lead.length)), level: 0 });
        return;
      }
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
  // FAQ questions ("What is included in the Harvard supplement?") aren't names.
  if (text.endsWith("?")) return `Short answer ${index}`;
  // Headings that state a limit are instructions ("Please respond in 100 words"), not names.
  if (text && text.length <= MAX_LABEL_CHARS && !parseLimit(text)) return text;
  return `Prompt ${index}`;
}

/** True for notes that only read like prompts: no question and no writing verb, or a process opener. */
export function isInstructionOnly(text) {
  if (text.includes("?")) return false;
  return !PROMPT_VERB.test(text) || INSTRUCTION_START.test(text);
}

/** Heading text → audience it limits the prompts to, or null. */
function headingAudience(text, perSchool = false) {
  if (PROGRAM_SPECIFIC.test(text)) return text.replace(/[:\s]+$/, "");
  const named = AUDIENCE_HEADING.test(text) || (perSchool && SCHOOL_HEADING.test(text));
  if (!named || ALL_APPLICANTS.test(text)) return null;
  return text.replace(/^for\s+/i, "").replace(/[:\s]+$/, "");
}

/** "Short Essay 1: Briefly discuss..." → { label: "Short Essay 1", body: "Briefly discuss..." }. */
function splitLabelPrefix(text) {
  const m = text.match(LABEL_PREFIX);
  return m ? { label: m[1], body: text.slice(m[0].length) } : { label: null, body: text };
}

/** "For Applicants to the College of Arts & Sciences: ..." → { audience, body } or null. */
function splitAudienceLine(text) {
  const m = text.match(AUDIENCE_LINE);
  if (!m || ALL_APPLICANTS.test(m[1])) return null;
  return { audience: m[1].trim(), body: m[0].trimEnd().endsWith(":") ? text.slice(m[0].length) : text };
}

/**
 * Extract prompts from blocks. Returns [{ label, prompt, limit, unit, required, options }];
 * limit is null only for prompts under an explicit "Question 1 (Required)"-style heading.
 */
export function extractFromBlocks(rawBlocks) {
  const prompts = [];
  const perSchool = rawBlocks.some((b) => b.level === 0 && PER_SCHOOL_PAGE.test(b.text));
  const blocks = rawBlocks.map((b) =>
    b.level === 0 && b.text.length <= MAX_LABEL_CHARS && !b.text.includes("?") && SECTION_TITLE.test(b.text)
      ? { ...b, level: MINOR_HEADING }
      : b
  );
  let heading = null; // { text, level, limit, explicit }
  let skipLevel = null; // inside a skipped section opened at this level
  let intro = null; // { limit, level, optional, label, audience }
  let group = null; // open choose-one prompt collecting options
  let audienceSection = null; // { audience, level } under a heading like "For B.S.E. Degree Applicants"
  let introAt = -2; // index of the last intro line
  let pending = []; // questions with no limit yet; a limit line right after them applies back ("…100–200 words each")

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
      pending = [];
      if (skipLevel !== null && level > skipLevel) continue;
      skipLevel = SKIP_SECTION.test(text) && !FIRST_YEAR.test(text) ? level : null;
      if (group && level <= group.level) closeGroup();
      if (intro && level <= intro.level) intro = null;
      if (audienceSection && level <= audienceSection.level) audienceSection = null;
      if (skipLevel !== null) continue;
      const limit = parseLimit(text);
      heading = { text, level, limit, explicit: PROMPT_HEADING.test(text) && !text.includes("?") };
      const audience = headingAudience(text, perSchool);
      if (audience) audienceSection = { audience, level };
      if (limit) intro = { limit, level, optional: OPTIONAL.test(text) };
      if (CHOOSE_ONE.test(text)) {
        openGroup({ ...(limit || {}), required: !OPTIONAL.test(text), explicit: heading.explicit, level });
      }
      continue;
    }
    if (skipLevel !== null) continue;

    const own = parseLimit(text);
    const prefixed = splitLabelPrefix(text);
    const lineAudience = splitAudienceLine(prefixed.body);
    const body = lineAudience ? lineAudience.body : prefixed.body;
    // A line that names its own label or audience is a prompt when it asks for writing.
    const labelled = Boolean(prefixed.label || lineAudience) && body.length >= MIN_PROMPT_CHARS;
    // After an intro line ("...based on the following prompt:"), a writing request counts even without "?".
    const introduced = introAt === i - 1 && body.length >= MIN_OPTION_CHARS && body.length <= MAX_PROMPT_CHARS;
    const isPrompt =
      looksLikePrompt(body) || (labelled && PROMPT_VERB.test(body)) || (introduced && WRITING_VERB.test(body));

    // Intro lines set a limit (and choose-one mode) for the prompts that follow.
    if (own && ESSAY_CONTEXT.test(text) && !text.includes("?") && (!isPrompt || INTRO_WORDS.test(text))) {
      closeGroup();
      const optional = OPTIONAL.test(text) || OPTIONAL.test(heading?.text || "");
      intro = { limit: own, level: sectionLevel(), optional, label: prefixed.label, audience: lineAudience?.audience ?? null };
      introAt = i;
      for (const q of pending) prompts.push({ ...q, ...own });
      pending = [];
      if (CHOOSE_ONE.test(text)) openGroup({ prompt: text, ...own, required: !optional, level: sectionLevel() });
      continue;
    }
    if (!own && !text.includes("?") && LIST_INTRO.test(text) && !CHOOSE_ONE.test(text)) {
      introAt = i;
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
    // A closing note ("We look forward to reading...") ends a choose-one list.
    if (group && group.options.length && !text.includes("?") && !PROMPT_VERB.test(text) && !ATTRIBUTION.test(text)) {
      closeGroup();
      continue;
    }
    // Inside a choose-one group any substantial paragraph is an option.
    const groupOption = group && text.length >= MIN_OPTION_CHARS;
    if ((!isPrompt && !groupOption) || isLimitOnly(text) || ATTRIBUTION.test(text)) continue;
    if ((LOGISTICS.test(text) || APPLICATION_NOTE.test(text)) && !text.includes("?")) continue;
    if (!group && NOTE_HEADING.test((heading?.text || "").trim())) continue;
    if (group ? INSTRUCTION_START.test(text) : isInstructionOnly(body)) continue;
    // Transfer and graduate prompts often share a page with first-year ones.
    if (TRANSFER.test(text) || (TRANSFER.test(heading?.text || "") && !FIRST_YEAR.test(heading.text))) continue;

    const next = blocks[i + 1];
    const adjacent = next && next.level === 0 && next.text.length <= MAX_LIMIT_LINE_CHARS ? parseLimit(next.text) : null;
    const limit = own || adjacent || intro?.limit || heading?.limit || null;

    if (group) {
      group.options.push(text);
      if (!group.limit && limit) Object.assign(group, limit);
      continue;
    }
    const named = lineAudience?.audience || intro?.audience || null;
    const audience = named || audienceSection?.audience || null;
    const base = prefixed.label || intro?.label || formatLabel(heading?.text, prompts.length + 1);
    const entry = {
      // A heading audience is already in the heading label; a line audience isn't.
      label: named
        ? `${base}: ${named}`
        : prefixed.label && audienceSection
          ? `${audienceSection.audience}: ${prefixed.label}`
          : base,
      prompt: body,
      limit: limit?.limit ?? null,
      unit: limit?.unit ?? "words",
      required: !(audience || OPTIONAL.test(text) || OPTIONAL.test(heading?.text || "") || intro?.optional),
      options: [],
      explicit: Boolean(heading?.explicit),
      ...(audience ? { audience } : {}),
    };
    if (!limit && !heading?.explicit) pending.push(entry);
    else prompts.push(entry);
    // Consecutive prompts in an introduced list keep the list open.
    if (introAt === i - 1) introAt = i;
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

const cycleFrom = (start) => `${start}-${String((start + 1) % 100).padStart(2, "0")}`;

/**
 * Detect an admissions-cycle label like "2026-27" in page text, else infer it
 * from the latest entering class named ("Class of 2031", "Fall 2027" → 2026-27).
 */
export function detectCycle(text, now = new Date()) {
  const m = text.match(CYCLE);
  if (m) {
    const start = Number(m[1]);
    return Number(m[2]) === (start + 1) % 100 ? cycleFrom(start) : null;
  }
  // Pages also mention later years ("test policy for Fall 2028"), so keep the
  // latest entering class whose cycle has already opened.
  const openStart = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const starts = [...text.matchAll(ENTRY_YEAR)]
    .map((e) => Number(e[2]) - (/class/i.test(e[1]) ? 4 : 0) - 1)
    .filter((start) => start <= openStart);
  return starts.length ? cycleFrom(Math.max(...starts)) : null;
}

/** Full page → { title, cycle, prompts }. */
export function extractPrompts(html) {
  const { blocks, title } = htmlToBlocks(html);
  const prompts = extractFromBlocks(blocks);
  const cycle = detectCycle(`${title} ${blocks.slice(0, 40).map((b) => b.text).join(" ")}`);
  return { title, cycle, prompts };
}
