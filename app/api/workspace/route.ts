import { NextRequest } from "next/server";
import {
  redactWorkspaceBody,
  getWorkspace,
  resetWorkspace,
  updateWorkspace,
  canCompleteOnboarding,
  type Workspace,
  type OnboardingListPrefs,
  type ListAmbition,
  type Activity,
  type Honor,
} from "@/lib/store";
import { rebalanceWorkspace, seedRecommendedColleges, type Rebalance } from "@/lib/college-recommendations";
import { applyApprovedList, finishOnboarding, setInterviewPhase } from "@/lib/onboarding-list";
import { startInterview } from "@/lib/interview-checklist";
import { splitStoryNotes } from "@/lib/story-notes";
import { syncEssaySupplements } from "@/lib/essay-supplements";
import { getWorkspaceId } from "@/lib/workspace-cookie";
import { deleteAllLogins } from "@/lib/portal-logins";
import { deleteAllSetup } from "@/lib/portal-setup";
import { deleteGptzero } from "@/lib/gptzero-login";
import { deleteLetters } from "@/lib/decision-letters";
import { createShareLink, revokeShareLink } from "@/lib/sharing";
import { removeAllParents } from "@/lib/parents";
import { applyWorkspacePatch, checkWorkspacePatch, isStalePatch, workspacePatchError, type WorkspacePatch } from "@/lib/workspace-patch";
import { checkAidAgainstWorkspace } from "@/lib/aid-validate";
import {
  getRecovery,
  newRecoveryCode,
  putRecovery,
  newShareToken,
  putShare,
  getShare,
} from "@/lib/share-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withCookie(data: unknown, setCookie?: string, status = 200): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  if (setCookie) headers["set-cookie"] = setCookie;
  return new Response(JSON.stringify(redactWorkspaceBody(data)), { status, headers });
}

function workspaceCookie(id: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAge = 60 * 60 * 24 * 365;
  return `cf_workspace=${id}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export async function GET(req: NextRequest) {
  const { id, setCookie } = await getWorkspaceId(req);
  const ws = await getWorkspace(id);
  return withCookie(ws, setCookie);
}

type Body = {
  action?: string;
  /** apply-list: draft schools the student kept, and current schools they dropped. */
  keep?: unknown;
  drop?: unknown;
  /** set-interview-phase */
  phase?: unknown;
  strategyConfirmed?: unknown;
  applicant?: Partial<Workspace["applicant"]>;
  profile?: Partial<{
    intended: string;
    hs: string;
    gradYear: number | string;
    location: string;
    counselor: string;
    residency: string;
  }>;
  testing?: Partial<{ sat: string; satNote: string; act: string }>;
  storyNotes?: { activities?: string; awards?: string; other?: string };
  listPrefs?: Partial<OnboardingListPrefs>;
  activities?: Activity[];
  honors?: Honor[];
  patch?: WorkspacePatch;
  code?: string;
  label?: string;
  token?: string;
};

class OnboardingValidationError extends Error {}
class StalePatchError extends Error {}
class AidPatchError extends Error {}
class PatchValidationError extends Error {}

const STALE_MESSAGE = "Your profile changed while you were editing. Review the latest version and save again.";

/** One write path for PATCH and action "patch": validate, refuse stale whole-list saves, then apply. */
async function runPatch(id: string, raw: unknown, setCookie?: string): Promise<Response> {
  if (!isObject(raw)) return withCookie({ success: false, error: "A patch object is required." }, setCookie, 400);
  const checked = checkWorkspacePatch(raw as WorkspacePatch);
  if (!checked.ok) return withCookie({ success: false, error: checked.error }, setCookie, 400);
  try {
    const next = await updateWorkspace(id, (ws) => {
      if (isStalePatch(ws, checked.value)) throw new StalePatchError(STALE_MESSAGE);
      const aidError = checkAidAgainstWorkspace(ws, checked.value);
      if (aidError) throw new AidPatchError(aidError);
      const invalid = workspacePatchError(ws, checked.value);
      if (invalid) throw new PatchValidationError(invalid);
      return applyWorkspacePatch(ws, checked.value);
    });
    return withCookie({ success: true, data: next }, setCookie);
  } catch (error) {
    if (error instanceof AidPatchError) return withCookie({ success: false, error: error.message }, setCookie, 400);
    if (error instanceof PatchValidationError) return withCookie({ success: false, error: error.message }, setCookie, 400);
    if (!(error instanceof StalePatchError)) throw error;
    return withCookie({ success: false, error: STALE_MESSAGE, data: await getWorkspace(id) }, setCookie, 409);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const AMBITIONS = new Set<ListAmbition>(["ambitious", "balanced", "conservative"]);

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

export async function POST(req: NextRequest) {
  const { id, setCookie } = await getWorkspaceId(req);
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return withCookie({ success: false, error: "Invalid JSON body." }, setCookie, 400);
  }
  if (!isObject(body)) return withCookie({ success: false, error: "A JSON object is required." }, setCookie, 400);
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "reset") {
    // Like share links, parents lose access to a reset workspace. First, and not best-effort: a parent who kept
    // access would see whatever the student adds next.
    try {
      await removeAllParents(id);
    } catch (error) {
      console.error("reset: could not remove parents", error instanceof Error ? error.name : "unknown");
      return withCookie({ success: false, error: "Couldn't reset. Try again." }, setCookie, 500);
    }
    const ws = await resetWorkspace(id);
    // A reset clears the tracker, so its saved portal logins and decision letters go too.
    await deleteAllLogins(id).catch(() => undefined);
    await deleteAllSetup(id).catch(() => undefined);
    await deleteGptzero(id).catch(() => undefined);
    await deleteLetters(id).catch(() => undefined);
    return withCookie(ws, setCookie);
  }

  if (action === "patch" || (!action && body.patch)) {
    return runPatch(id, body.patch || body, setCookie);
  }

  if (action === "rebalance") {
    // Refill the automatic picks for the current preferences; schools the student or an agent added, and priority schools, stay.
    let result: Omit<Rebalance, "workspace"> = { added: [], removed: [], gaps: [] };
    const next = await updateWorkspace(id, (ws) => {
      const { workspace, ...changes } = rebalanceWorkspace(ws);
      result = changes;
      return syncEssaySupplements(workspace);
    });
    return withCookie({ success: true, data: next, ...result }, setCookie);
  }

  if (action === "create-recovery") {
    const candidate = newRecoveryCode();
    const next = await updateWorkspace(id, (ws) => ({ ...ws, recoveryCode: ws.recoveryCode || candidate }));
    const code = next.recoveryCode!;
    await putRecovery(code, id);
    return withCookie({ success: true, code, data: next }, setCookie);
  }

  if (action === "claim-recovery") {
    const code = str(body.code).toUpperCase();
    if (code.length < 6) {
      return withCookie({ success: false, error: "Enter your full recovery code." }, setCookie, 400);
    }
    const rec = await getRecovery(code);
    if (!rec) {
      return withCookie({ success: false, error: "Unknown or expired recovery code." }, setCookie, 404);
    }
    const ws = await getWorkspace(rec.workspaceId);
    if (ws.recoveryCode !== code) {
      return withCookie({ success: false, error: "Unknown or expired recovery code." }, setCookie, 404);
    }
    return withCookie(
      { success: true, data: ws },
      workspaceCookie(rec.workspaceId)
    );
  }

  if (action === "create-share") {
    const scope = (body as { scope?: string }).scope === "progress" ? "progress" : "full";
    const { token, workspace } = await createShareLink(id, scope, str(body.label));
    return withCookie({ success: true, token, data: workspace }, setCookie);
  }

  if (action === "revoke-share") {
    const token = str(body.token);
    if (!token) return withCookie({ success: false, error: "token required" }, setCookie, 400);
    return withCookie({ success: true, data: await revokeShareLink(id, token) }, setCookie);
  }

  if (action === "start-interview") {
    // A redo keeps `completed`, so the hub stays usable; answers already in the profile count as given.
    const saved = await updateWorkspace(id, (ws) => ({
      ...ws,
      onboarding: { ...ws.onboarding, interview: startInterview(Date.now()) },
    }));
    return withCookie({ success: true, data: saved }, setCookie);
  }

  if (action === "apply-list" || action === "finish-onboarding" || action === "set-interview-phase") {
    const names = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.slice(0, 160)).slice(0, 40) : []);
    let error = "";
    const saved = await updateWorkspace(id, (ws) => {
      error = ""; // the store can re-run this on a version conflict
      const r = action === "apply-list"
        ? applyApprovedList(ws, names(body.keep), names(body.drop))
        : action === "finish-onboarding"
          ? finishOnboarding(ws, Date.now())
          : setInterviewPhase(ws, body.phase, body.strategyConfirmed === true);
      if ("error" in r) { error = r.error; return ws; }
      return r;
    });
    if (error) return withCookie({ success: false, error }, setCookie, 400);
    return withCookie({ success: true, data: saved }, setCookie);
  }

  if (action === "complete-onboarding") {
    try {
      const saved = await updateWorkspace(id, (ws) => {
        const a = body.applicant || {};
        const p = body.profile || {};
        const t = body.testing || {};
        const sn = body.storyNotes || {};
        const lp = body.listPrefs || {};
        // Same field rules as every other profile write; blanks mean "not given" here.
        const checked = checkWorkspacePatch({
          applicant: { gpaWeighted: a.gpaWeighted, gpaUnweighted: a.gpaUnweighted, sat: a.sat || t.sat },
          profile: { gradYear: p.gradYear, residency: p.residency, testing: { act: t.act } },
          listPrefs: lp,
        }, "tool");
        if (!checked.ok) throw new OnboardingValidationError(checked.error);
        const residency = checked.value.profile?.residency ?? ws.profile.residency;
        const act = checked.value.profile?.testing?.act;

        const name = str(a.name);
        const cycle = str(a.cycle);
        const year = str(a.year);
        const gpaWeighted = str(a.gpaWeighted) || "—";
        const gpaUnweighted = str(a.gpaUnweighted) || "—";
        const sat = str(a.sat) || str(t.sat) || "—";
        const satNote = str(a.satNote) || str(t.satNote) || "";
        const intended = str(p.intended);
        const hs = str(p.hs);
        const location = str(p.location);
        let gradYear: number | string = p.gradYear ?? "";
        if (typeof gradYear === "string") gradYear = gradYear.trim();
        if (gradYear !== "" && !Number.isNaN(Number(gradYear))) gradYear = Number(gradYear);

        const cycleOut = cycle || (gradYear ? `Fall ${gradYear}` : "");
        const yearOut = year || (gradYear ? `Class of ${gradYear}` : "");

        const ambition: ListAmbition = AMBITIONS.has(lp.ambition as ListAmbition)
          ? (lp.ambition as ListAmbition)
          : "balanced";
        let appCount: number | null = null;
        if (typeof lp.appCount === "number" && Number.isFinite(lp.appCount)) {
          appCount = Math.max(8, Math.min(15, Math.round(lp.appCount)));
        } else if (lp.appCount === null) {
          appCount = null;
        }

        const listPrefs: OnboardingListPrefs = {
          ambition,
          appCount,
          settings: Array.isArray(lp.settings)
            ? lp.settings.map((s) => str(s)).filter(Boolean).slice(0, 8)
            : [],
          size: str(lp.size) || "any",
          regions: Array.isArray(lp.regions)
            ? lp.regions.map((s) => str(s)).filter(Boolean).slice(0, 12)
            : [],
          notes: str(lp.notes).slice(0, 4000),
          ...(checked.value.listPrefs?.budget ? { budget: checked.value.listPrefs.budget } : {}),
          ...(typeof lp.needAid === "boolean" ? { needAid: lp.needAid } : {}),
          ...(checked.value.listPrefs?.ed ? { ed: checked.value.listPrefs.ed } : {}),
        };

        const storyNotes = {
          activities: str(sn.activities).slice(0, 20_000),
          awards: str(sn.awards).slice(0, 12_000),
          other: str(sn.other).slice(0, 12_000),
        };

        // With no saved activities, one story line becomes one activity or honor, so the profile is filled without AI.
        const givenActivities = Array.isArray(body.activities) ? body.activities : ws.profile.activities;
        const givenHonors = Array.isArray(body.honors) ? body.honors : ws.profile.honors;
        const fromStory = givenActivities.length ? null : splitStoryNotes(storyNotes);
        const activities = fromStory ? fromStory.activities : givenActivities;
        const honors = fromStory && !givenHonors.length ? fromStory.honors : givenHonors;
        const awardsCount =
          typeof a.awards === "number" && Number.isFinite(a.awards)
            ? a.awards
            : honors.length || ws.applicant.awards || 0;

        let next: Workspace = {
          ...ws,
          applicant: {
            ...ws.applicant,
            name,
            cycle: cycleOut,
            year: yearOut,
            gpaWeighted: gpaWeighted || "—",
            gpaUnweighted: gpaUnweighted || "—",
            sat: sat || "—",
            satNote,
            awards: awardsCount,
          },
          profile: {
            ...ws.profile,
            intended,
            hs,
            gradYear: gradYear === "" ? "" : gradYear,
            location,
            residency,
            testing: {
              ...ws.profile.testing,
              sat: sat || "—",
              satNote,
              ...(act !== undefined ? { act } : {}),
            },
            activities,
            honors,
          },
          onboarding: {
            ...ws.onboarding,
            completed: false, // set true after validation below
            storyNotes,
            listPrefs,
          },
        };

        const check = canCompleteOnboarding(next);
        if (!check.ok) {
          throw new OnboardingValidationError(check.error);
        }

        // Preserve every saved choice, then fill from the same evidence shown in Discover.
        const seeded = seedRecommendedColleges(next);
        next.colleges = seeded.colleges;
        // Open Essays-tab groups for every seeded school (UC PIQs / placeholders).
        next = syncEssaySupplements(next);

        next.onboarding = {
          ...next.onboarding,
          completed: true,
          completedAt: Date.now(),
          storyNotes,
          listPrefs,
          listGaps: seeded.gaps,
        };
        return next;
      });
      return withCookie({ success: true, data: saved }, setCookie);
    } catch (error) {
      if (error instanceof OnboardingValidationError) {
        return withCookie({ success: false, error: error.message }, setCookie, 400);
      }
      throw error;
    }
  }

  const ws = await getWorkspace(id);
  return withCookie(ws, setCookie);
}

/** PATCH /api/workspace with a WorkspacePatch body */
export async function PATCH(req: NextRequest) {
  const { id, setCookie } = await getWorkspaceId(req);
  let patch: WorkspacePatch = {};
  try {
    patch = (await req.json()) as WorkspacePatch;
  } catch {
    return withCookie({ success: false, error: "Invalid JSON" }, setCookie, 400);
  }
  return runPatch(id, patch, setCookie);
}
