import { corsJson, preflight, resourceMetadata } from "@/lib/oauth-http";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => corsJson(resourceMetadata(req));
export const OPTIONS = preflight;
