import { bundledModels, loadModels, selectModels } from "@neelsatyavolu/shared-ai-auth";

// Projects may blacklist IDs without changing the shared catalog. New IDs remain visible.
const HIDDEN_MODELS = { codex: [] as string[], grok: [] as string[] };
let cached = bundledModels;
let refreshAt = 0;

export async function providerModels(provider: "codex" | "grok") {
  if (Date.now() >= refreshAt) {
    cached = await loadModels({ fallback: cached });
    refreshAt = Date.now() + 5 * 60_000;
  }
  return selectModels(cached, provider, HIDDEN_MODELS[provider]);
}
