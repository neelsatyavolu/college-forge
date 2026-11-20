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
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
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
  if (isIP(host) === 6) return !(host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.startsWith("::ffff:"));
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
