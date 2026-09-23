import { NextRequest } from "next/server";
import {
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
import { seedRecommendedColleges } from "@/lib/college-recommendations";
import { syncEssaySupplements } from "@/lib/essay-supplements";
import { getWorkspaceId } from "@/lib/workspace-cookie";
import { applyWorkspacePatch, type WorkspacePatch } from "@/lib/workspace-patch";
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
  return new Response(JSON.stringify(data), { status, headers });
}

function workspaceCookie(id: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAge = 60 * 60 * 24 * 365;
  return `cf_workspace=${id}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export async function GET(req: NextRequest) {
  const { id, setCookie } = getWorkspaceId(req);
  const ws = await getWorkspace(id);
  return withCookie(ws, setCookie);
}

type Body = {
  action?: string;
  applicant?: Partial<Workspace["applicant"]>;
  profile?: Partial<{
    intended: string;
    hs: string;
    gradYear: number | string;
    location: string;
    counselor: string;
    residency: string;
  }>;
  testing?: Partial<{ sat: string; satNote: string }>;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const AMBITIONS = new Set<ListAmbition>(["ambitious", "balanced", "conservative"]);

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

export async function POST(req: NextRequest) {
  const { id, setCookie } = getWorkspaceId(req);
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return withCookie({ success: false, error: "Invalid JSON body." }, setCookie, 400);
  }
  if (!isObject(body)) return withCookie({ success: false, error: "A JSON object is required." }, setCookie, 400);
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "reset") {
    const ws = await resetWorkspace(id);
    return withCookie(ws, setCookie);
  }

  if (action === "patch" || (!action && body.patch)) {
    const patch = body.patch || (body as WorkspacePatch);
    if (!isObject(patch)) return withCookie({ success: false, error: "A patch object is required." }, setCookie, 400);
    const next = await updateWorkspace(id, (ws) => applyWorkspacePatch(ws, patch));
    return withCookie({ success: true, data: next }, setCookie);
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
    const token = newShareToken();
    const label = str(body.label) || "Advisor link";
    const meta = { token, label, createdAt: Date.now() };
    await putShare({ ...meta, workspaceId: id });
    const next = await updateWorkspace(id, (ws) => ({
      ...ws,
      shares: [...(ws.shares || []).filter((s) => !s.revokedAt && s.token !== token), meta],
    }));
    return withCookie({ success: true, token, data: next }, setCookie);
  }

  if (action === "revoke-share") {
    const token = str(body.token);
    if (!token) return withCookie({ success: false, error: "token required" }, setCookie, 400);
    const existing = await getShare(token);
    if (existing && existing.workspaceId === id) {
      await putShare({ ...existing, revokedAt: Date.now() });
    }
    const next = await updateWorkspace(id, (ws) => ({
      ...ws,
      shares: (ws.shares || []).map((s) =>
        s.token === token ? { ...s, revokedAt: Date.now() } : s
      ),
    }));
    return withCookie({ success: true, data: next }, setCookie);
  }

  if (action === "complete-onboarding") {
    try {
      const saved = await updateWorkspace(id, (ws) => {
        const a = body.applicant || {};
        const p = body.profile || {};
        const t = body.testing || {};
        const sn = body.storyNotes || {};
        const lp = body.listPrefs || {};

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
        };

        const storyNotes = {
          activities: str(sn.activities).slice(0, 20_000),
          awards: str(sn.awards).slice(0, 12_000),
          other: str(sn.other).slice(0, 12_000),
        };

        const activities = Array.isArray(body.activities) ? body.activities : ws.profile.activities;
        const honors = Array.isArray(body.honors) ? body.honors : ws.profile.honors;
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
            testing: {
              ...ws.profile.testing,
              sat: sat || "—",
              satNote,
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
        next.colleges = seedRecommendedColleges(next);
        // Open Essays-tab groups for every seeded school (UC PIQs / placeholders).
        next = syncEssaySupplements(next);

        next.onboarding = {
          ...next.onboarding,
          completed: true,
          completedAt: Date.now(),
          storyNotes,
          listPrefs,
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
  const { id, setCookie } = getWorkspaceId(req);
  let patch: WorkspacePatch = {};
  try {
    patch = (await req.json()) as WorkspacePatch;
  } catch {
    return withCookie({ success: false, error: "Invalid JSON" }, setCookie, 400);
  }
  if (!isObject(patch)) return withCookie({ success: false, error: "A patch object is required." }, setCookie, 400);
  const next = await updateWorkspace(id, (ws) => applyWorkspacePatch(ws, patch));
  return withCookie({ success: true, data: next }, setCookie);
}
