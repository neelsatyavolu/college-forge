/**
 * Fallback source: CollegeVine's structured per-school prompt page
 * (collegevine.com/schools/<slug>/essay-prompts). Each prompt is a card with
 * an <h3> label, a Required/Optional badge, a "250 Words" limit and the
 * prompt text, plus optional "Option N" sub-prompts. CollegeVine can lag the
 * official cycle, so results carry the cycle from the page heading.
 * CollegeVine slugs differ from ours ("ohio-state-university-osu"), so pages
 * are matched by school name through its public sitemap.
 */

import { gunzipSync } from "node:zlib";
import * as cheerio from "cheerio";
import { detectCycle } from "./extract.mjs";
import { nameKey, nameVariants } from "./discover.mjs";

const SITEMAP = "https://www.collegevine.com/sitemap.xml.gz";
const PROMPT_PAGE = /<loc>(https:\/\/www\.collegevine\.com\/schools\/([^/<]+)\/essay-prompts)<\/loc>/g;
const NO_ESSAYS = /does not require essays/i;

export const collegeVineUrl = (slug) => `https://www.collegevine.com/schools/${slug}/essay-prompts`;

async function getXml(url, http) {
  const res = await http.get(url, { binary: true });
  if (res.status !== 200 || !res.buffer) return "";
  try {
    return (url.endsWith(".gz") ? gunzipSync(res.buffer) : res.buffer).toString("utf8");
  } catch {
    return "";
  }
}

/** Map(nameKey(slug words) → essay-prompts URL) from CollegeVine's sitemaps; empty on failure. */
export async function loadCollegeVineIndex(http) {
  const index = new Map();
  const root = await getXml(SITEMAP, http);
  for (const [, child] of root.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const xml = await getXml(child, http);
    for (const [, url, slug] of xml.matchAll(PROMPT_PAGE)) index.set(nameKey(slug.replace(/-/g, " ")), url);
  }
  return index;
}

/**
 * CollegeVine page for a school: exact name match, else a slug that adds one
 * trailing abbreviation token ("ohio state university osu"), else our slug.
 */
export function collegeVineUrlFor(index, name, slug) {
  const variants = nameVariants(name);
  for (const key of variants) if (index.has(key)) return index.get(key);
  for (const key of variants) {
    for (const [cvKey, url] of index) {
      if (cvKey.startsWith(`${key} `) && !cvKey.slice(key.length + 1).includes(" ")) return url;
    }
  }
  return collegeVineUrl(slug);
}

const clean = (t) => t.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

export function parseCollegeVine(html) {
  const $ = cheerio.load(html);
  // Pages without prompts drop the "…2024-25 Essay Prompts" heading; the <title> keeps it.
  const heading =
    clean($("h1").filter((_, h) => /essay/i.test($(h).text())).first().text()) || clean($("title").first().text());
  const prompts = [];
  $(".card-body").each((_, el) => {
    const card = $(el);
    const label = clean(card.find("h3").first().text());
    const limitText = clean(card.find("span.text-secondary").first().text());
    const m = limitText.match(/(\d+)\s*(words?|characters?)/i);
    if (!label || !m) return; // skips non-prompt cards and "Pages" uploads
    // Their markup nests <p> in <p>; the parser splits those into sibling
    // paragraphs, so read every direct paragraph child in order.
    const paragraphs = (scope) =>
      scope.children("p").map((_, p) => clean($(p).text())).get().filter(Boolean).join("\n\n");
    const prompt = paragraphs(card);
    const options = card
      .find("h5")
      .filter((_, h) => /^option\s*\d+$/i.test(clean($(h).text())))
      .map((_, h) => paragraphs($(h).parent()))
      .get()
      .filter(Boolean);
    if (!prompt && options.length === 0) return;
    prompts.push({
      label,
      prompt,
      limit: Number(m[1]),
      unit: /^w/i.test(m[2]) ? "words" : "characters",
      required: /required/i.test(clean(card.find(".badge").first().text())),
      options,
    });
  });
  // Their "no prompts" notice also covers "not available yet", so callers
  // should only trust it for a cycle that has already opened.
  const noEssays = prompts.length === 0 && NO_ESSAYS.test($("body").text());
  return { title: heading, cycle: detectCycle(heading), prompts, noEssays };
}
