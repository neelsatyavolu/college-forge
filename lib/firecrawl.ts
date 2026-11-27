/**
 * Optional self-hosted Firecrawl (github.com/firecrawl/firecrawl) for web research. Set
 * FIRECRAWL_API_URL to the server's base URL (and FIRECRAWL_API_KEY if it requires one). The server is
 * fixed by the operator; the pages it fetches come from the model, so private and local addresses are
 * refused before they reach it.
 */

import { isIP } from "node:net";

const TIMEOUT_MS = 28_000;

export type FirecrawlHit = { title: string; url: string; snippet: string };
export type FirecrawlPage = { url: string; title: string; text: string };

export function firecrawlBase(): string | null {
  const raw = (process.env.FIRECRAWL_API_URL || "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function privateV4(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
    // Benchmarking 198.18.0.0/15, IETF 192.0.0.0/24, and multicast, reserved and broadcast (224.0.0.0 and up).
    || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0 && c === 0) || a >= 224;
}

/** The eight 16-bit groups of an IPv6 literal (any embedded IPv4 tail converted), or null. */
function v6Groups(ip: string): number[] | null {
  let s = ip.replace(/%.*$/, "");
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail[1].split(".").map(Number);
    s = s.slice(0, -tail[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = s.split("::");
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const fill = s.includes("::") ? 8 - left.length - right.length : 0;
  const groups = [...left, ...Array(Math.max(fill, 0)).fill("0"), ...right].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

function privateV6(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return true;
  // ::/96 (unspecified, loopback, IPv4-compatible) and ::ffff:0:0/96 (IPv4-mapped).
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0 || g[5] === 0xffff)) return true;
  // NAT64 64:ff9b::/96 and 64:ff9b:1::/48 reach IPv4 through a translator.
  if (g[0] === 0x64 && g[1] === 0xff9b) return true;
  // 6to4 2002::/16 embeds an IPv4 address in the next 32 bits.
  if (g[0] === 0x2002) return privateV4(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`);
  // Unique local fc00::/7, link-local fe80::/10, site-local fec0::/10, multicast ff00::/8.
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00;
}

// Wildcard DNS services that answer with whatever address the name spells (or always 127.0.0.1).
const WILDCARD_DNS = /(^|\.)(nip\.io|sslip\.io|xip\.io|traefik\.me|localtest\.me|lvh\.me|vcap\.me|lacolhost\.com|localhost\.run)$/;

/** A private IPv4 address spelled inside a name, such as 10.0.0.1.example.com or app-127-0-0-1.example.com. */
function embedsPrivateV4(host: string): boolean {
  for (const m of host.matchAll(/(?:^|[^\d])(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})(?![\d])/g)) {
    const ip = m.slice(1, 5).join(".");
    if (isIP(ip) === 4 && privateV4(ip)) return true;
  }
  return false;
}

/** A public http(s) page: no localhost, internal names, or private / link-local IP literals. */
export function isPublicPageUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") && isIP(host) === 0) return false;
  if (/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) return false;
  if (isIP(host) === 4) return !privateV4(host);
  if (isIP(host) === 6) return !privateV6(host);
  if (WILDCARD_DNS.test(host) || embedsPrivateV4(host)) return false;
  return true;
}

async function post(path: string, body: unknown): Promise<{ json?: unknown; error?: string }> {
  const base = firecrawlBase();
  if (!base) return { error: "Firecrawl is not configured." };
  const key = (process.env.FIRECRAWL_API_KEY || "").trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return { error: `Firecrawl (${res.status})` };
    return { json: await res.json() };
  } catch (err) {
    return { error: err instanceof Error && err.name === "AbortError" ? "Firecrawl timed out." : "Firecrawl could not be reached." };
  } finally {
    clearTimeout(timer);
  }
}

export async function firecrawlSearch(query: string, limit: number): Promise<FirecrawlHit[] | { error: string }> {
  const r = await post("/v2/search", { query, limit, sources: [{ type: "web" }] });
  if (r.error) return { error: r.error };
  const data = (r.json as { success?: boolean; data?: { web?: unknown[] } }) || {};
  if (!data.success) return { error: "Firecrawl search failed." };
  return (Array.isArray(data.data?.web) ? data.data!.web : []).flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!url) return [];
    return [{ url, title: (typeof o.title === "string" && o.title.trim()) || "Untitled", snippet: typeof o.description === "string" ? o.description.trim() : "" }];
  }).slice(0, limit);
}

export async function firecrawlScrape(url: string): Promise<FirecrawlPage | { error: string }> {
  if (!isPublicPageUrl(url)) return { error: "Only public web pages can be fetched." };
  const r = await post("/v2/scrape", { url, formats: ["markdown"], onlyMainContent: true });
  if (r.error) return { error: r.error };
  const data = (r.json as { success?: boolean; data?: { markdown?: string; metadata?: { title?: string; sourceURL?: string; url?: string } } }) || {};
  const text = typeof data.data?.markdown === "string" ? data.data.markdown.trim() : "";
  if (!data.success || !text) return { error: `Could not extract content from ${url}.` };
  const meta = data.data?.metadata || {};
  return { url: meta.url || meta.sourceURL || url, title: (meta.title || "").trim() || "Untitled", text };
}
