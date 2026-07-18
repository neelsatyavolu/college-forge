// Live web search for the Hub Assistant, backed by the Exa API.
// Exposed to the model as the `web_search` tool alongside `read_file`.

const EXA_ENDPOINT = "https://api.exa.ai/search";
const NUM_RESULTS = 5;
const PER_RESULT_CHARS = 1_200;
const MAX_OUTPUT_CHARS = 8_000;
const TIMEOUT_MS = 20_000;

export function getExaKey(): string | null {
  return process.env.EXA_API_KEY ?? null;
}

export const WEB_SEARCH_TOOL = {
  name: "web_search",
  description:
    "Search the live web for current information the hub files don't cover or " +
    "that may have changed since they were written — e.g. up-to-date admissions " +
    "stats, 2026-27 application deadlines, supplement prompts, scholarship amounts, " +
    "recent news. Returns ranked results with titles, URLs, publish dates, and " +
    "content excerpts. Always cite the source URL for any fact taken from a result.",
  parameters: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          "The web search query. Be specific — include the school name, the year, " +
          "and the exact thing you need (e.g. 'Tufts University Class of 2029 admit rate').",
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

export async function runWebSearch(query: string): Promise<WebSearchResult> {
  const key = getExaKey();
  if (!key) {
    return {
      ok: false,
      error:
        "Web search is not configured. Set EXA_API_KEY in website/.env.local to enable it.",
    };
  }
  const trimmed = query.trim();
  if (!trimmed) return { ok: false, error: "web_search requires a non-empty 'query'." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(EXA_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({
        query: trimmed,
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
    if (results.length === 0) {
      return { ok: true, content: `No web results found for "${trimmed}".` };
    }

    const blocks = results.map((r, i) => {
      const title = (r.title ?? "Untitled").trim();
      const url = r.url ?? "(no url)";
      const date = r.publishedDate ? ` · ${r.publishedDate.slice(0, 10)}` : "";
      const body = (r.text ?? "").replace(/\s+/g, " ").trim().slice(0, PER_RESULT_CHARS);
      return `[${i + 1}] ${title}${date}\n${url}\n${body || "(no excerpt available)"}`;
    });
    const content = `Web search results for "${trimmed}":\n\n${blocks.join("\n\n")}`.slice(
      0,
      MAX_OUTPUT_CHARS
    );
    return { ok: true, content };
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
