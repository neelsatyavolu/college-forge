import { listDocs, readDoc } from "@/lib/doc-store";
import { emailHash, fromCollegeAppsWorker } from "@/lib/service-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Email hashes of everyone already in Forge: College Apps accounts that brought their schools over, and
 * every Forge account. The one-time "College Apps is now Forge" notice skips these. Hashes only.
 */
export async function GET(req: Request) {
  if (!fromCollegeAppsWorker(req)) return Response.json({ error: "Missing or wrong service key." }, { status: 401 });
  try {
    const moved = (await listDocs("collegeapps-moved/")).map((k) => k.split("/").pop()!.replace(/\.json$/, "")).filter((h) => /^[0-9a-f]{64}$/.test(h));
    const accounts = await Promise.all((await listDocs("accounts/")).map((k) => readDoc<{ email?: string }>(k).catch(() => null)));
    const forge = accounts.flatMap((a) => (a?.email ? [emailHash(a.email)] : []));
    return Response.json({ hashes: [...new Set([...moved, ...forge])] }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("moved list failed", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Something went wrong on Forge's side." }, { status: 500 });
  }
}
