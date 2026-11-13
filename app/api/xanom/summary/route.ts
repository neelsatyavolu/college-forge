import { verifySummaryRequest } from "@/lib/xanom";
import { getAccount } from "@/lib/session";
import { getWorkspace } from "@/lib/store";
import { decisionOf, statusInfo } from "@/lib/tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGIN = "https://forge.xanom.co";

/** The card on the Xanom dashboard (SPEC §4): counts only, nothing sensitive. */
export async function GET(req: Request) {
  const sub = await verifySummaryRequest(req.headers.get("authorization"));
  if (!sub) return new Response("unauthorized", { status: 401 });
  const account = await getAccount(sub);
  if (!account) return Response.json({ linked: false });
  const { tracker } = await getWorkspace(account.workspaceId);
  const apps = tracker.apps;
  const waiting = apps.filter((a) => statusInfo(a.status).stage === "waiting").length;
  const decided = apps.filter((a) => ["recorded", "revealed", "hidden"].includes(decisionOf(a).state)).length;
  const submitted = apps.filter((a) => statusInfo(a.status).stage !== "working").length;
  return Response.json({
    linked: true,
    headline: apps.length ? `${apps.length} application${apps.length === 1 ? "" : "s"} · ${decided} decision${decided === 1 ? "" : "s"}` : "No applications yet",
    items: [
      { label: "Applications", value: String(apps.length) },
      { label: "Submitted", value: String(submitted) },
      { label: "Waiting", value: String(waiting) },
      { label: "Decisions", value: String(decided) },
    ],
    recent: [],
    url: `${ORIGIN}/hub/index.html`,
  });
}
