import { authServerMetadata, corsJson, preflight } from "@/lib/oauth-http";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => corsJson(authServerMetadata(req));
export const OPTIONS = preflight;
