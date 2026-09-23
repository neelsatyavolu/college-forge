/**
 * Polite HTTP for the supplement scraper: identifies itself, honors
 * robots.txt Disallow rules for "*", spaces requests per host, retries
 * transient failures, and times out slow servers.
 */

const DEFAULT_UA =
  "CollegeForgeSupplementBot/1.0 (+https://github.com/neelsatyavolu/college-forge; yearly essay-prompt refresh)";
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Parse the "User-agent: *" group of a robots.txt into Allow/Disallow rules. */
export function parseRobots(text) {
  const rules = [];
  let applies = false;
  let sawRule = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      // A new group starts after rules; consecutive user-agent lines share one group.
      if (sawRule) { applies = false; sawRule = false; }
      if (value === "*") applies = true;
    } else if (key === "disallow" || key === "allow") {
      sawRule = true;
      if (applies && value) rules.push({ allow: key === "allow", pattern: value });
    }
  }
  return rules;
}

function ruleMatches(pattern, path) {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

/** Longest matching rule wins; Allow wins ties (RFC 9309). */
export function robotsAllows(rules, path) {
  let best = null;
  for (const rule of rules) {
    if (!ruleMatches(rule.pattern, path)) continue;
    const longer = !best || rule.pattern.length > best.pattern.length;
    const tieAllow = best && rule.pattern.length === best.pattern.length && rule.allow;
    if (longer || tieAllow) best = rule;
  }
  return !best || best.allow;
}

export function createFetcher({
  userAgent = DEFAULT_UA,
  perHostDelayMs = 1500,
  timeoutMs = 20_000,
  retries = 2,
} = {}) {
  const robots = new Map(); // origin → Promise<rules>
  const nextSlot = new Map(); // host → earliest next request time

  async function waitTurn(host) {
    const now = Date.now();
    const at = Math.max(now, nextSlot.get(host) || 0);
    nextSlot.set(host, at + perHostDelayMs);
    if (at > now) await sleep(at - now);
  }

  async function rawGet(url, binary = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "user-agent": userAgent, accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5" },
        redirect: "follow",
        signal: controller.signal,
      });
      if (binary) return { status: res.status, url: res.url, text: "", buffer: Buffer.from(await res.arrayBuffer()) };
      return { status: res.status, url: res.url, text: await res.text() };
    } finally {
      clearTimeout(timer);
    }
  }

  function rulesFor(origin) {
    if (!robots.has(origin)) {
      robots.set(
        origin,
        rawGet(`${origin}/robots.txt`)
          .then((r) => (r.status === 200 ? parseRobots(r.text) : []))
          .catch(() => [])
      );
    }
    return robots.get(origin);
  }

  /**
   * GET a URL as text (or { buffer } with binary: true).
   * Returns { status, url, text } or { status: 0, error }.
   */
  async function get(url, { binary = false } = {}) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { status: 0, url, text: "", error: "invalid URL" };
    }
    const rules = await rulesFor(parsed.origin);
    if (!robotsAllows(rules, parsed.pathname + parsed.search)) {
      return { status: 0, url, text: "", error: "blocked by robots.txt" };
    }
    let last = { status: 0, url, text: "", error: "not attempted" };
    for (let attempt = 0; attempt <= retries; attempt++) {
      await waitTurn(parsed.host);
      try {
        last = await rawGet(url, binary);
        if (!RETRY_STATUSES.has(last.status)) return last;
      } catch (err) {
        last = { status: 0, url, text: "", error: err?.name === "AbortError" ? "timeout" : String(err?.message || err) };
      }
      await sleep(2000 * (attempt + 1));
    }
    return last;
  }

  return { get };
}
