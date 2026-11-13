import { catalogForClient } from "@/lib/tracker";

export const dynamic = "force-static";

/** The 330-school catalog for the "Add a school" picker. Public data. */
export function GET() {
  return Response.json(catalogForClient(), { headers: { "cache-control": "public, max-age=3600, stale-while-revalidate=86400" } });
}
