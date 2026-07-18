// Live web search for the hub copilot.
// Providers (in order):
//   1. Exa — EXA_API_KEY or WEB_SEARCH_API_KEY
//   2. DuckDuckGo HTML — always available, no key required
// Exposed to the model as the `web_search` tool.

const EXA_ENDPOINT = "https://api.exa.ai/search";
const NUM_RESULTS = 5;
const PER_RESULT_CHARS = 1_200;
const MAX_OUTPUT_CHARS = 8_000;
const TIMEOUT_MS = 20_000;

/** Prefer EXA_API_KEY; accept WEB_SEARCH_API_KEY as an alias (see .env.example). */
export function getExaKey(): string | null {
  return process.env.EXA_API_KEY || process.env.WEB_SEARCH_API_KEY || null;
}

/** True when at least one backend can run (Exa key or free DuckDuckGo fallback). */
export function isWebSearchAvailable(): boolean {
  return true; // DuckDuckGo fallback has no key requirement
}

export function webSearchProviderLabel(): "exa" | "duckduckgo" {
  return getExaKey() ? "exa" : "duckduckgo";
}

export const WEB_SEARCH_TOOL = {
  name: "web_search",
  description:
    "Search the live web for current information — admissions stats, 2025–27 deadlines, " +
    "supplement prompts, scholarship amounts, rankings, net price, recent news. " +
    "Returns ranked results with titles, URLs, and excerpts. Always cite the source URL " +
    "for facts you use. Prefer this over inventing numbers.",
  parameters: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          "Specific query — school name + year + fact needed " +
          "(e.g. 'Tufts University Class of 2029 admit rate' or 'UCLA ED deadline 2026').",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export type WebSearchResult = { ok: true; content: string } | { ok: false; error: string };

type ExaResult = {
  title?: string | null;
  url?: string;
  publishedDate?: string | null;
  text?: string | null;
};

type ParsedHit = { title: string; url: string; snippet: string; date?: string };

function formatHits(query: string, hits: ParsedHit[], via: string): string {
  if (!hits.length) return `No web results found for "${query}".`;
  const blocks = hits.map((r, i) => {
    const date = r.date ? ` · ${r.date}` : "";
    const body = r.snippet.replace(/\s+/g, " ").trim().slice(0, PER_RESULT_CHARS);
    return `[${i + 1}] ${r.title}${date}\n${r.url}\n${body || "(no excerpt available)"}`;
  });
  return `Web search results for "${query}" (via ${via}):\n\n${blocks.join("\n\n")}`.slice(
    0,
    MAX_OUTPUT_CHARS
  );
}

async function searchExa(query: string, key: string): Promise<WebSearchResult> {
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
        contents: { text: { maxCharacters: PER_RESULT_CHARS } },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Exa search failed (${res.status}): ${detail.slice(0, 300)}`,
      };
    }

    const json = (await res.json()) as { results?: ExaResult[] };
    const results = Array.isArray(json.results) ? json.results : [];
    const hits: ParsedHit[] = results.map((r) => ({
      title: (r.title ?? "Untitled").trim(),
      url: r.url ?? "(no url)",
      snippet: (r.text ?? "").trim(),
      date: r.publishedDate ? r.publishedDate.slice(0, 10) : undefined,
    }));
    return { ok: true, content: formatHits(query, hits, "Exa") };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: `Exa search timed out after ${TIMEOUT_MS / 1000}s.` };
    }
    return {
      ok: false,
      error: `Exa search request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Decode common HTML entities in DDG snippets/titles. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

/**
 * Free fallback: DuckDuckGo HTML results page.
 * No API key. Best-effort parse of result cards.
 */
function unwrapDdgHref(raw: string): string {
  let href = decodeEntities(raw).trim();
  // //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=...
  const uddg = href.match(/[?&]uddg=([^&]+)/i);
  if (uddg) {
    try {
      href = decodeURIComponent(uddg[1]);
    } catch {
      /* keep */
    }
  }
  if (href.startsWith("//")) href = "https:" + href;
  return href;
}

async function searchDuckDuckGo(query: string): Promise<WebSearchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        // Generic browser UA — DDG returns empty SERP for some bot UAs.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      return { ok: false, error: `DuckDuckGo search failed (${res.status}).` };
    }
    const html = await res.text();
    const hits: ParsedHit[] = [];
    const seen = new Set<string>();

    // Flexible match: attributes may appear in either order on result__a
    const linkRe = /<a\b([^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null && hits.length < NUM_RESULTS) {
      const attrs = m[1] || "";
      const hrefMatch = attrs.match(/\bhref="([^"]+)"/i);
      if (!hrefMatch) continue;
      const href = unwrapDdgHref(hrefMatch[1]);
      const title = stripTags(m[2]);
      if (!title || !href || href.includes("duckduckgo.com/y.js")) continue;
      if (seen.has(href)) continue;
      seen.add(href);

      // Snippet lives in the following result body
      const after = html.slice(m.index + m[0].length, m.index + m[0].length + 1200);
      const snipMatch = after.match(/class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\//i);
      const snippet = snipMatch ? stripTags(snipMatch[1]) : "";
      hits.push({ title, url: href, snippet });
    }

    // Instant Answer API as last resort for a single abstract
    if (!hits.length) {
      try {
        const ia = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
          { signal: controller.signal, headers: { accept: "application/json" } }
        );
        if (ia.ok) {
          const j = (await ia.json()) as {
            AbstractText?: string;
            AbstractURL?: string;
            Heading?: string;
            RelatedTopics?: { Text?: string; FirstURL?: string }[];
          };
          if (j.AbstractText) {
            hits.push({
              title: j.Heading || query,
              url: j.AbstractURL || "https://duckduckgo.com",
              snippet: j.AbstractText,
            });
          }
          for (const t of j.RelatedTopics || []) {
            if (hits.length >= NUM_RESULTS) break;
            if (t.Text && t.FirstURL) {
              hits.push({ title: t.Text.slice(0, 80), url: t.FirstURL, snippet: t.Text });
            }
          }
        }
      } catch {
        /* ignore IA failure */
      }
    }

    return { ok: true, content: formatHits(query, hits, "DuckDuckGo") };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: `Web search timed out after ${TIMEOUT_MS / 1000}s.` };
    }
    return {
      ok: false,
      error: `Web search failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runWebSearch(query: string): Promise<WebSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: false, error: "web_search requires a non-empty 'query'." };

  const exaKey = getExaKey();
  if (exaKey) {
    const exa = await searchExa(trimmed, exaKey);
    if (exa.ok) return exa;
    // Fall through to DuckDuckGo if Exa errors
    console.warn(`[web-search] Exa failed, falling back to DuckDuckGo: ${exa.error}`);
  }

  return searchDuckDuckGo(trimmed);
}
