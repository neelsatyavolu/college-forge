/**
 * Find a school's official supplemental-essay page without a search API:
 * start from the first-year admissions site Common App lists for the school,
 * follow on-site links that look like essay/supplement/apply pages (two
 * levels), run the extractor on each, and keep the page yielding the most
 * prompts.
 */

import * as cheerio from "cheerio";
import { extractPrompts } from "./extract.mjs";
import { needsRender } from "./render.mjs";

const STRONG = /\b(essays?|supplement(?:al|s)?|short[- ]answers?|specific[- ]questions|writing[- ]requirements?|prompts?|member questions)\b/i;
const MEDIUM = /\b(apply|application|first[- ]year|freshman|freshmen|requirements|how[- ]to[- ]apply|applying|undergraduate)\b/i;
const NEGATIVE =
  /\b(transfer|graduate|grad|mba|law|medic(?:al|ine)|news|blog|events?|visit|tours?|financial|aid|cost|tuition|scholarships?|faculty|staff|login|portal|status|jobs|careers|alumni|give|giving|donate|calendar|library)\b/i;
const TRANSFER = /transfer|\bgraduate\b|\bgrad\b/i;
const MAX_STRONG = 6;
const MAX_MEDIUM = 4;
const MAX_PAGES = 14;
export const GOOD_ENOUGH_PROMPTS = 3;

/** Registrable-ish site key: last two host labels (princeton.edu). */
export function siteKey(host) {
  return host.toLowerCase().split(".").slice(-2).join(".");
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function scoreLink(text, href) {
  const path = safeDecode(href).replace(/[-_/]+/g, " ");
  const hay = `${text} ${path}`;
  if (NEGATIVE.test(path) || (NEGATIVE.test(text) && !STRONG.test(text))) return 0;
  if (STRONG.test(hay)) return 2;
  if (MEDIUM.test(hay)) return 1;
  return 0;
}

/** Same-site links on a page, ranked by how essay-like they look. */
export function rankLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const site = siteKey(new URL(baseUrl).host);
  const best = new Map(); // url → score
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") || "";
    let url;
    try {
      url = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || siteKey(url.host) !== site) return;
    if (/\.(pdf|docx?|jpe?g|png|zip)$/i.test(url.pathname)) return;
    url.hash = "";
    const score = scoreLink($(a).text().trim(), url.pathname);
    if (score > (best.get(url.href) || 0)) best.set(url.href, score);
  });
  return [...best.entries()].sort((a, b) => b[1] - a[1]).map(([url, score]) => ({ url, score }));
}

const COMMON_APP = "https://www.commonapp.org";
const COMMON_APP_PROBE = `${COMMON_APP}/page-data/explore/princeton-university/page-data.json`;

/** Loose school-name key: "The University of Texas--Austin" → "university texas austin". */
export function nameKey(name) {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/--|—|–/g, " ")
    .replace(/\bsaint\b/g, "st")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|at|of|in|main campus)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Name variants to try: full, before "--" or ",", and with the campus dropped. */
export function nameVariants(name) {
  const base = name.split(/--|,/)[0];
  return [...new Set([name, base, name.replace(/--/g, " at "), name.replace(/,/g, " at ")].map(nameKey))];
}

/**
 * Common App's public explore site is a Gatsby build; one of its static
 * queries lists every member school with admissions URLs. The query hash
 * changes between deploys, so find it via a school page's staticQueryHashes.
 * Returns Map(nameKey → first-year admissions URL); empty on failure.
 */
export async function loadCommonAppIndex(http) {
  const index = new Map();
  const probe = await http.get(COMMON_APP_PROBE);
  if (probe.status !== 200) return index;
  let hashes = [];
  try {
    hashes = JSON.parse(probe.text).staticQueryHashes || [];
  } catch {
    return index;
  }
  for (const hash of hashes) {
    const res = await http.get(`${COMMON_APP}/page-data/sq/d/${hash}.json`);
    if (res.status !== 200 || !res.text.includes("allNodeSchool")) continue;
    try {
      for (const { node } of JSON.parse(res.text).data.allNodeSchool.edges) {
        const site = node.relationships?.field_site_update || {};
        const url = site.field_su_addr_fy_adm_website || site.field_su_addr_adm_website;
        if (node.title && url) index.set(nameKey(node.title), url);
      }
    } catch {
      continue;
    }
    break;
  }
  return index;
}

export function commonAppHome(index, name) {
  for (const key of nameVariants(name)) if (index.has(key)) return index.get(key);
  return null;
}

/**
 * Fetch a page's HTML (robots-checked), rendering it in headless Chrome when
 * the static HTML is a client-side shell. Returns { url, html } or null.
 */
export async function fetchPage(url, { http, renderer }) {
  const res = await http.get(url);
  if (res.status !== 200 || !res.text) return null;
  const finalUrl = res.url || url;
  if (renderer && needsRender(res.text)) {
    const rendered = await renderer.render(finalUrl);
    if (rendered) return { url: finalUrl, html: rendered };
  }
  return { url: finalUrl, html: res.text };
}

function pageScore(result) {
  return result.prompts.length;
}

/**
 * Crawl from a start URL and return the best prompt page:
 * { url, result } or null when nothing yields prompts.
 */
export async function discoverPromptPage(startUrl, ctx) {
  const visited = new Set();
  let best = null;

  const visit = async (url) => {
    if (visited.has(url) || visited.size >= MAX_PAGES) return null;
    visited.add(url);
    const page = await fetchPage(url, ctx);
    if (!page || TRANSFER.test(new URL(page.url).pathname)) return null;
    const result = extractPrompts(page.html);
    if (pageScore(result) > 0 && (!best || pageScore(result) > pageScore(best.result))) {
      best = { url: page.url, result };
    }
    return page;
  };

  const home = await visit(startUrl);
  if (!home) return best;
  const links = rankLinks(home.html, home.url);
  const strong = links.filter((l) => l.score === 2).slice(0, MAX_STRONG);
  const medium = links.filter((l) => l.score === 1).slice(0, MAX_MEDIUM);

  // A page with only one or two prompts is often a summary; keep looking.
  const goodEnough = () => best && best.result.prompts.length >= GOOD_ENOUGH_PROMPTS;
  for (const l of strong) await visit(l.url);
  if (goodEnough()) return best;
  for (const l of medium) {
    const res = await visit(l.url);
    if (!res) continue;
    const deeper = rankLinks(res.html, res.url).filter((d) => d.score === 2).slice(0, MAX_STRONG);
    for (const d of deeper) await visit(d.url);
    if (goodEnough()) return best;
  }
  return best;
}
