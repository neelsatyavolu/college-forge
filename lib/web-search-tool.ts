/**
 * Live web research for the hub copilot.
 *
 * Quality stack:
 *   1. Exa Search — neural ranking + page text excerpts (EXA_API_KEY)
 *   2. TinyFish Search — free SERP backup / merge (TINYFISH_API_KEY)
 *   3. TinyFish Fetch — full-page markdown for top URLs (TINYFISH_API_KEY)
 *
 * Env (Vercel Production/Preview or .env.local):
 *   EXA_API_KEY=...
 *   TINYFISH_API_KEY=...
 *   WEB_SEARCH_API_KEY=...   # optional alias for EXA_API_KEY
 */

const EXA_ENDPOINT = "https://api.exa.ai/search";
const TINYFISH_SEARCH = "https://api.search.tinyfish.ai";
const TINYFISH_FETCH = "https://api.fetch.tinyfish.ai";

const NUM_RESULTS = 6;
const PER_RESULT_CHARS = 1_800;
const FETCH_TEXT_CHARS = 4_000;
const MAX_OUTPUT_CHARS = 12_000;
const TIMEOUT_MS = 28_000;
/** How many top search hits to deep-read via TinyFish Fetch. */
const DEEP_FETCH_TOP = 2;

function trimKey(raw: string | undefined): string | null {
  const k = (raw || "").trim();
  return k.length > 0 ? k : null;
}

export function getExaKey(): string | null {
  return trimKey(process.env.EXA_API_KEY) || trimKey(process.env.WEB_SEARCH_API_KEY);
}

export function getTinyFishKey(): string | null {
  return trimKey(process.env.TINYFISH_API_KEY);
}

/** True when at least one of Exa or TinyFish is configured. */
export function isWebSearchAvailable(): boolean {
  return Boolean(getExaKey() || getTinyFishKey());
}

export function isWebFetchAvailable(): boolean {
  return Boolean(getTinyFishKey());
}

export type WebSearchProviderLabel = "exa+tinyfish" | "exa" | "tinyfish" | "none";

export function webSearchProviderLabel(): WebSearchProviderLabel {
  const exa = Boolean(getExaKey());
  const tf = Boolean(getTinyFishKey());
  if (exa && tf) return "exa+tinyfish";
  if (exa) return "exa";
  if (tf) return "tinyfish";
  return "none";
}

export const WEB_SEARCH_TOOL = {
  name: "web_search",
  description:
    "Search the live web for current admissions facts (admit rates, ED/RD deadlines, SAT ranges, " +
    "net price, rankings, supplements, scholarships). Uses Exa + TinyFish when configured; returns " +
    "ranked results with URLs and excerpts, and deep-reads top pages when TinyFish Fetch is available. " +
    "Always cite source URLs. Prefer this over inventing numbers.",
  parameters: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          "Specific query — school name + year + fact " +
          "(e.g. 'Tufts University Class of 2029 admit rate' or 'UCLA RD deadline 2026').",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export const WEB_FETCH_TOOL = {
  name: "web_fetch",
  description:
    "Fetch a specific URL and extract clean page text (via TinyFish). Use after web_search " +
    "when you need full admissions pages, Common Data Set tables, or deadline pages. " +
    "Pass a full https URL from search results.",
  parameters: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description: "Full https URL to fetch (from web_search results or a known official page).",
      },
      purpose: {
        type: "string",
        description: "Optional: why you need the page (improves extraction quality).",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
};

export type WebSearchResult = { ok: true; content: string } | { ok: false; error: string };

type Hit = {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  source: "exa" | "tinyfish";
};

function normalizeUrl(u: string): string {
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    // drop common tracking
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((k) =>
      parsed.searchParams.delete(k)
    );
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return u.trim();
  }
}

function formatHits(query: string, hits: Hit[], via: string): string {
  if (!hits.length) return `No web results found for "${query}".`;
  const blocks = hits.map((r, i) => {
    const date = r.date ? ` · ${r.date}` : "";
    const body = r.snippet.replace(/\s+/g, " ").trim().slice(0, PER_RESULT_CHARS);
    return `[${i + 1}] ${r.title}${date} (${r.source})\n${r.url}\n${body || "(no excerpt available)"}`;
  });
  return `Web search results for "${query}" (via ${via}):\n\n${blocks.join("\n\n")}`.slice(
    0,
    MAX_OUTPUT_CHARS
  );
}

// ── Exa ──────────────────────────────────────────────────────────────────

type ExaResult = {
  title?: string | null;
  url?: string;
  publishedDate?: string | null;
  text?: string | null;
  highlights?: string[] | null;
  summary?: string | null;
};

function snippetFromExa(r: ExaResult): string {
  if (typeof r.summary === "string" && r.summary.trim()) return r.summary.trim();
  if (Array.isArray(r.highlights) && r.highlights.length) {
    return r.highlights.filter(Boolean).join(" … ").trim();
  }
  if (typeof r.text === "string" && r.text.trim()) return r.text.trim();
  return "";
}

async function searchExa(query: string, key: string): Promise<Hit[] | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(EXA_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: NUM_RESULTS,
        useAutoprompt: true,
        contents: { text: { maxCharacters: PER_RESULT_CHARS } },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { error: `Exa (${res.status}): ${detail.slice(0, 200)}` };
    }
    const json = (await res.json()) as { results?: ExaResult[] };
    const results = Array.isArray(json.results) ? json.results : [];
    return results
      .map((r): Hit | null => {
        const url = (r.url ?? "").trim();
        if (!url) return null;
        return {
          title: (r.title ?? "Untitled").trim() || "Untitled",
          url,
          snippet: snippetFromExa(r),
          date: r.publishedDate ? String(r.publishedDate).slice(0, 10) : undefined,
          source: "exa",
        };
      })
      .filter((h): h is Hit => Boolean(h));
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { error: "Exa timed out." };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// ── TinyFish Search ──────────────────────────────────────────────────────

type TfSearchResult = {
  position?: number;
  site_name?: string;
  title?: string;
  snippet?: string;
  url?: string;
};

async function searchTinyFish(query: string, key: string): Promise<Hit[] | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      query,
      purpose: "College admissions research: rates, deadlines, testing, official school pages",
    });
    const res = await fetch(`${TINYFISH_SEARCH}?${params.toString()}`, {
      method: "GET",
      headers: { "X-API-Key": key, accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { error: `TinyFish Search (${res.status}): ${detail.slice(0, 200)}` };
    }
    const json = (await res.json()) as { results?: TfSearchResult[] };
    const results = Array.isArray(json.results) ? json.results : [];
    return results
      .slice(0, NUM_RESULTS)
      .map((r): Hit | null => {
        const url = (r.url ?? "").trim();
        if (!url) return null;
        return {
          title: (r.title ?? "Untitled").trim() || "Untitled",
          url,
          snippet: (r.snippet ?? "").trim(),
          source: "tinyfish",
        };
      })
      .filter((h): h is Hit => Boolean(h));
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { error: "TinyFish Search timed out." };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// ── TinyFish Fetch ───────────────────────────────────────────────────────

type TfFetchPage = {
  url?: string;
  final_url?: string;
  title?: string;
  description?: string;
  text?: string;
};

async function fetchTinyFish(
  urls: string[],
  key: string,
  purpose?: string
): Promise<{ pages: { url: string; title: string; text: string }[]; error?: string }> {
  const clean = urls.map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, 10);
  if (!clean.length) return { pages: [], error: "No valid https URLs to fetch." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = {
      urls: clean,
      format: "markdown",
      ttl: 3600,
    };
    if (purpose && purpose.trim()) body.purpose = purpose.trim().slice(0, 2000);

    const res = await fetch(TINYFISH_FETCH, {
      method: "POST",
      headers: {
        "X-API-Key": key,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { pages: [], error: `TinyFish Fetch (${res.status}): ${detail.slice(0, 200)}` };
    }
    const json = (await res.json()) as { results?: TfFetchPage[]; errors?: unknown[] };
    const pages = (Array.isArray(json.results) ? json.results : [])
      .map((r) => ({
        url: (r.final_url || r.url || "").trim(),
        title: (r.title || "").trim() || "Untitled",
        text: typeof r.text === "string" ? r.text.trim() : "",
      }))
      .filter((p) => p.url && p.text);
    return { pages };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { pages: [], error: "TinyFish Fetch timed out." };
    }
    return { pages: [], error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// ── Merge / public API ───────────────────────────────────────────────────

function mergeHits(primary: Hit[], secondary: Hit[]): Hit[] {
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const h of [...primary, ...secondary]) {
    const key = normalizeUrl(h.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= NUM_RESULTS + 2) break;
  }
  return out;
}

/**
 * Search the web: Exa (rank + text) + TinyFish Search (merge) + TinyFish Fetch (deep-read top URLs).
 */
export async function runWebSearch(query: string): Promise<WebSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: false, error: "web_search requires a non-empty 'query'." };

  const exaKey = getExaKey();
  const tfKey = getTinyFishKey();

  if (!exaKey && !tfKey) {
    console.warn("[web-search] neither EXA_API_KEY nor TINYFISH_API_KEY set");
    return {
      ok: false,
      error:
        "Web search is not configured. Set EXA_API_KEY and/or TINYFISH_API_KEY " +
        "in Vercel env or .env.local.",
    };
  }

  const errors: string[] = [];
  let exaHits: Hit[] = [];
  let tfHits: Hit[] = [];

  // Run both searches in parallel when both keys exist
  const jobs: Promise<void>[] = [];
  if (exaKey) {
    jobs.push(
      searchExa(trimmed, exaKey).then((r) => {
        if (Array.isArray(r)) exaHits = r;
        else errors.push(r.error);
      })
    );
  }
  if (tfKey) {
    jobs.push(
      searchTinyFish(trimmed, tfKey).then((r) => {
        if (Array.isArray(r)) tfHits = r;
        else errors.push(r.error);
      })
    );
  }
  await Promise.all(jobs);

  // Prefer Exa order; fill gaps with TinyFish
  const merged = mergeHits(exaHits, tfHits);
  if (!merged.length) {
    return {
      ok: false,
      error:
        errors.length > 0
          ? `Web search failed. ${errors.join(" · ")}`
          : `No web results found for "${trimmed}".`,
    };
  }

  const viaParts = [
    exaHits.length ? "Exa" : null,
    tfHits.length ? "TinyFish Search" : null,
  ].filter(Boolean);
  let content = formatHits(trimmed, merged, viaParts.join(" + ") || "search");

  // Deep-read top pages when TinyFish Fetch is available (max quality)
  if (tfKey) {
    const topUrls = merged
      .slice(0, DEEP_FETCH_TOP)
      .map((h) => h.url)
      .filter((u) => /^https?:\/\//i.test(u));
    if (topUrls.length) {
      const deep = await fetchTinyFish(
        topUrls,
        tfKey,
        `Extract admissions stats, deadlines, testing policy, and class profile facts for: ${trimmed}`
      );
      if (deep.pages.length) {
        const deepBlocks = deep.pages.map((p, i) => {
          const body = p.text.replace(/\s+/g, " ").trim().slice(0, FETCH_TEXT_CHARS);
          return `### Full page ${i + 1}: ${p.title}\n${p.url}\n${body}`;
        });
        content = `${content}\n\n---\nDeep-read pages (TinyFish Fetch):\n\n${deepBlocks.join("\n\n")}`.slice(
          0,
          MAX_OUTPUT_CHARS
        );
        console.log(
          `[web-search] ok query="${trimmed.slice(0, 60)}" hits=${merged.length} deep=${deep.pages.length}`
        );
      } else if (deep.error) {
        console.warn(`[web-search] deep fetch skipped: ${deep.error}`);
      }
    }
  } else {
    console.log(`[web-search] ok query="${trimmed.slice(0, 60)}" hits=${merged.length} (no TinyFish fetch)`);
  }

  return { ok: true, content };
}

/**
 * Fetch one or more URLs via TinyFish Fetch (full page markdown).
 */
export async function runWebFetch(
  url: string,
  purpose?: string
): Promise<WebSearchResult> {
  const u = (url || "").trim();
  if (!u) return { ok: false, error: "web_fetch requires a non-empty 'url'." };
  if (!/^https?:\/\//i.test(u)) {
    return { ok: false, error: "web_fetch requires a full http(s) URL." };
  }

  const tfKey = getTinyFishKey();
  if (!tfKey) {
    return {
      ok: false,
      error:
        "Page fetch is not configured. Set TINYFISH_API_KEY for TinyFish Fetch " +
        "(https://agent.tinyfish.ai/api-keys).",
    };
  }

  const deep = await fetchTinyFish([u], tfKey, purpose);
  if (!deep.pages.length) {
    return {
      ok: false,
      error: deep.error || `Could not extract content from ${u}.`,
    };
  }
  const p = deep.pages[0];
  const body = p.text.slice(0, MAX_OUTPUT_CHARS - 200);
  return {
    ok: true,
    content: `Fetched page (via TinyFish):\n# ${p.title}\n${p.url}\n\n${body}`,
  };
}
