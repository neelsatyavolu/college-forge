import { OAuthError, registerClient } from "@/lib/oauth";
import { corsJson, preflight } from "@/lib/oauth-http";
import { allow, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const OPTIONS = preflight;

/** RFC 7591 dynamic client registration. Every client is public and must use PKCE. */
export async function POST(req: Request) {
  if (!(await allow(`register:${clientIp(req)}`, 20, 60 * 60 * 1000))) {
    return corsJson({ error: "slow_down", error_description: "Too many registrations from this address. Try again later." }, 429);
  }
  try {
    const c = await registerClient(await req.json().catch(() => null));
    return corsJson(
      {
        client_id: c.client_id,
        client_id_issued_at: c.created_at,
        client_name: c.client_name,
        redirect_uris: c.redirect_uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      201,
    );
  } catch (err) {
    if (err instanceof OAuthError) return corsJson({ error: err.code, error_description: err.message }, 400);
    console.error("oauth register failed", err instanceof Error ? err.message : "unknown");
    return corsJson({ error: "server_error" }, 500);
  }
}
