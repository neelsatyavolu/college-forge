/**
 * Live web search for the hub copilot — Exa only.
 *
 * Set EXA_API_KEY (or WEB_SEARCH_API_KEY alias) in .env.local / Vercel.
 * Dashboard: https://dashboard.exa.ai/api-keys
 *
 * Used by hub tools (web_search) and default tools in Grok/Codex/OpenCode clients.
 */

const EXA_ENDPOINT = "https://api.exa.ai/search";
const NUM_RESULTS = 6;
const PER_RESULT_CHARS = 1_800;
const MAX_OUTPUT_CHARS = 10_000;
const TIMEOUT_MS = 25_000;

/** Prefer EXA_API_KEY; WEB_SEARCH_API_KEY is accepted as an alias. */
export function getExaKey(): string | null {
  const raw = process.env.EXA_API_KEY || process.env.WEB_SEARCH_API_KEY || "";
  const key = raw.trim();
  return key.length > 0 ? key : null;
}

/** True only when an Exa API key is configured. */
export function isWebSearchAvailable(): boolean {
  return Boolean(getExaKey());
}

export function webSearchProviderLabel(): "exa" | "none" {
  return getExaKey() ? "exa" : "none";
}

export const WEB_SEARCH_TOOL = {
  name: "web_search",
  description:
    "Search the live web (Exa) for current admissions facts: admit rates, ED/RD deadlines, " +
    "SAT ranges, net price, rankings, supplement requirements, scholarships, recent news. " +
    "Returns ranked results with titles, URLs, and page excerpts. Always cite the source URL " +
    "for facts you use. Prefer this over inventing numbers.",
  parameters: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          "Specific query — school name + year + fact needed " +
          "(e.g. 'Tufts University Class of 2029 admit rate' or 'UCLA RD application deadline 2026').",
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
  author?: string | null;
  text?: string | null;
  highlights?: string[] | null;
  summary?: string | null;
};

function formatHits(
  query: string,
  hits: { title: string; url: string; snippet: string; date?: string }[]
): string {
  if (!hits.length) return `No web results found for "${query}".`;
  const blocks = hits.map((r, i) => {
    const date = r.date ? ` · ${r.date}` : "";
    const body = r.snippet.replace(/\s+/g, " ").trim().slice(0, PER_RESULT_CHARS);
    return `[${i + 1}] ${r.title}${date}\n${r.url}\n${body || "(no excerpt available)"}`;
  });
  return `Web search results for "${query}" (via Exa):\n\n${blocks.join("\n\n")}`.slice(
    0,
    MAX_OUTPUT_CHARS
  );
}

function snippetFromResult(r: ExaResult): string {
  if (typeof r.summary === "string" && r.summary.trim()) return r.summary.trim();
  if (Array.isArray(r.highlights) && r.highlights.length) {
    return r.highlights.filter(Boolean).join(" … ").trim();
  }
  if (typeof r.text === "string" && r.text.trim()) return r.text.trim();
  return "";
}

async function searchExa(query: string, key: string): Promise<WebSearchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(EXA_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
      },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: NUM_RESULTS,
        // Prefer live-ish results for admissions deadlines / class profiles.
        useAutoprompt: true,
        contents: {
          text: { maxCharacters: PER_RESULT_CHARS },
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // Common misconfig hints
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          error:
            `Exa auth failed (${res.status}). Check EXA_API_KEY in Vercel / .env.local. ` +
            detail.slice(0, 200),
        };
      }
      return {
        ok: false,
        error: `Exa search failed (${res.status}): ${detail.slice(0, 300)}`,
      };
    }

    const json = (await res.json()) as { results?: ExaResult[]; requestId?: string };
    const results = Array.isArray(json.results) ? json.results : [];
    const hits = results
      .map((r) => ({
        title: (r.title ?? "Untitled").trim() || "Untitled",
        url: (r.url ?? "").trim() || "(no url)",
        snippet: snippetFromResult(r),
        date: r.publishedDate ? String(r.publishedDate).slice(0, 10) : undefined,
      }))
      .filter((h) => h.url !== "(no url)");

    console.log(
      `[web-search] exa ok query="${query.slice(0, 80)}" results=${hits.length}` +
        (json.requestId ? ` req=${json.requestId}` : "")
    );
    return { ok: true, content: formatHits(query, hits) };
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

/**
 * Run a live web search via Exa.
 * Returns a clear configuration error when EXA_API_KEY is missing.
 */
export async function runWebSearch(query: string): Promise<WebSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: false, error: "web_search requires a non-empty 'query'." };

  const exaKey = getExaKey();
  if (!exaKey) {
    console.warn("[web-search] EXA_API_KEY not set — web_search unavailable");
    return {
      ok: false,
      error:
        "Web search is not configured. Set EXA_API_KEY in the server environment " +
        "(.env.local locally, Vercel project env for production). Get a key at https://dashboard.exa.ai/api-keys",
    };
  }

  return searchExa(trimmed, exaKey);
}
