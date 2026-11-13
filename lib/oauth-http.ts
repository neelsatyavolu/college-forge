import { appOrigin } from "./origin";

/** Metadata and token endpoints are called by assistants' servers and sometimes from browsers. */
export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id",
};

export const corsJson = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { ...CORS, "cache-control": "no-store", ...extra } });

export const preflight = () => new Response(null, { status: 204, headers: CORS });

export function resourceMetadata(req: Request) {
  const origin = appOrigin(req);
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: ["applications"],
    bearer_methods_supported: ["header"],
    resource_name: "Forge applications",
    resource_documentation: `${origin}/hub/#settings`,
  };
}

export function authServerMetadata(req: Request) {
  const origin = appOrigin(req);
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["applications"],
  };
}
