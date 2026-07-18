import { NextRequest } from "next/server";
import {
  getWorkspace,
  resetWorkspace,
  saveWorkspace,
  canCompleteOnboarding,
  type Workspace,
  type OnboardingListPrefs,
  type ListAmbition,
  type Activity,
  type Honor,
} from "@/lib/store";
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
    // no body
  }
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "reset") {
    const ws = await resetWorkspace(id);
    return withCookie(ws, setCookie);
  }

  if (action === "patch" || (!action && body.patch)) {
    const patch = body.patch || (body as WorkspacePatch);
    const ws = await getWorkspace(id);
    const next = applyWorkspacePatch(ws, patch);
    await saveWorkspace(id, next);
    return withCookie({ success: true, data: next }, setCookie);
  }

  if (action === "create-recovery") {
    const ws = await getWorkspace(id);
    const code = ws.recoveryCode || newRecoveryCode();
    await putRecovery(code, id);
    const next = { ...ws, recoveryCode: code };
    await saveWorkspace(id, next);
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
    return withCookie(
      { success: true, data: ws, workspaceId: rec.workspaceId },
      workspaceCookie(rec.workspaceId)
    );
  }

  if (action === "create-share") {
    const ws = await getWorkspace(id);
    const token = newShareToken();
    const label = str(body.label) || "Advisor link";
    const meta = { token, label, createdAt: Date.now() };
    await putShare({ ...meta, workspaceId: id });
    const next: Workspace = {
      ...ws,
      shares: [...(ws.shares || []).filter((s) => !s.revokedAt), meta],
    };
    await saveWorkspace(id, next);
    return withCookie({ success: true, token, data: next }, setCookie);
  }

  if (action === "revoke-share") {
    const token = str(body.token);
    if (!token) return withCookie({ success: false, error: "token required" }, setCookie, 400);
    const existing = await getShare(token);
    if (existing && existing.workspaceId === id) {
      await putShare({ ...existing, revokedAt: Date.now() });
    }
    const ws = await getWorkspace(id);
    const next: Workspace = {
      ...ws,
      shares: (ws.shares || []).map((s) =>
        s.token === token ? { ...s, revokedAt: Date.now() } : s
      ),
    };
    await saveWorkspace(id, next);
    return withCookie({ success: true, data: next }, setCookie);
  }

  if (action === "complete-onboarding") {
    const ws = await getWorkspace(id);
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
    const listPrefs: OnboardingListPrefs = {
      ambition,
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

    const next: Workspace = {
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
      return withCookie({ success: false, error: check.error }, setCookie, 400);
    }

    next.onboarding = {
      ...next.onboarding,
      completed: true,
      completedAt: Date.now(),
      storyNotes,
      listPrefs,
    };
    await saveWorkspace(id, next);
    console.log(
      `[workspace] ws=${id.slice(0, 8)} onboarding complete name="${name}" ` +
        `colleges=${next.colleges.length} storyActs=${storyNotes.activities.length}c ambition=${ambition}`
    );
    return withCookie({ success: true, data: next }, setCookie);
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
  const ws = await getWorkspace(id);
  const next = applyWorkspacePatch(ws, patch);
  await saveWorkspace(id, next);
  return withCookie({ success: true, data: next }, setCookie);
}
