import { OAuthError, exchange } from "@/lib/oauth";
import { corsJson, preflight } from "@/lib/oauth-http";

export const runtime = "nodejs";
export const OPTIONS = preflight;

export async function POST(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  let form: URLSearchParams;
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    form = new URLSearchParams(Object.entries(body).filter(([, v]) => typeof v === "string") as [string, string][]);
  } else {
    form = new URLSearchParams(await req.text());
  }
  // Public clients may still send client_id in a Basic header.
  const basic = req.headers.get("authorization")?.match(/^Basic\s+(.+)$/)?.[1];
  if (basic && !form.get("client_id")) {
    const id = decodeURIComponent(Buffer.from(basic, "base64").toString("utf8").split(":")[0] ?? "");
    if (id) form.set("client_id", id);
  }
  try {
    return corsJson(await exchange(form), 200, { pragma: "no-cache" });
  } catch (err) {
    if (err instanceof OAuthError) return corsJson({ error: err.code, error_description: err.message }, err.status);
    console.error("oauth token failed", err instanceof Error ? err.message : "unknown");
    return corsJson({ error: "server_error" }, 500);
  }
}
