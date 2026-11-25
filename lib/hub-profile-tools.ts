import type { ToolSpec } from "./chat-types";
import type { Workspace } from "./store";
import { rebalanceWorkspace } from "./college-recommendations";
import { syncEssaySupplements } from "./essay-supplements";
import { applyWorkspacePatch, checkWorkspacePatch, type WorkspacePatch } from "./workspace-patch";
import { removeActivity, removeHonor, toolFlag, upsertActivity, upsertHonor, type Parsed } from "./profile-fields";

/**
 * The copilot's profile and list-preference tools. Every write goes through checkWorkspacePatch in tool
 * mode, so the same rules apply as on the Profile page, and "" or 0 arguments leave stored values alone.
 */

type Args = Record<string, unknown>;
type Mutate = (fn: (ws: Workspace) => Workspace) => Promise<Workspace>;

const str = { type: "string" } as const;
const activityFields = {
  name: str, type: { type: "string", description: "e.g. Academic, Arts, Athletics, Community Service, Work" },
  org: str, years: { type: "string", description: "Grades, e.g. '9, 10, 11, 12'" }, role: str,
  hpw: { type: "string", description: "hours per week" }, wpy: { type: "string", description: "weeks per year" },
  college: { type: "boolean", description: "intends to continue in college" },
  desc: { type: "string", description: "Common App description, up to 150 characters." },
  bullets: { type: "array", items: str },
};
/** For one-row edits, flags are "yes" | "no": models fill unused optional booleans with false. */
const yesNo = (description: string) => ({ type: "string", enum: ["yes", "no"], description } as const);
const honorFields = {
  title: str, level: { type: "string", description: "National | International | State | Regional | School" },
  year: str, top: { type: "boolean", description: "one of the strongest honors" },
};

export const PROFILE_TOOL_SPECS: ToolSpec[] = [
  {
    name: "set_applicant_snapshot",
    description:
      "Set the top-line applicant snapshot shown on the Overview and Profile pages. Provide only the fields you know; empty strings are ignored, and '—' clears a GPA or SAT. GPAs and SAT are strings (e.g. '4.28', '1540'). SAT is saved to the testing section too. The honors count is computed from the honors list.",
    parameters: {
      type: "object",
      properties: {
        name: str, cycle: { type: "string", description: "e.g. 'Fall 2027'" },
        year: { type: "string", description: "e.g. 'Junior — May 2027'" },
        gpaWeighted: { type: "string", description: "0 to 6" }, gpaUnweighted: { type: "string", description: "0 to 4" },
        sat: { type: "string", description: "Whole number 400-1600" }, satNote: { type: "string", description: "Superscore or sections, or 'Test optional'" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "set_profile_identity",
    description: "Set profile identity fields (Profile page 'Applicant' panel). Empty strings are ignored.",
    parameters: {
      type: "object",
      properties: {
        intended: { type: "string", description: "Intended major / academic path" },
        hs: { type: "string", description: "High school name" },
        gradYear: { type: "number", description: "Four-digit year" }, location: str,
        counselor: str, residency: { type: "string", description: "State of residence as a 2-letter code, e.g. CA" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "set_testing",
    description: "Set testing details: SAT (saved to the applicant snapshot too), a superscore/section note ('Test optional' when the student won't send scores), ACT composite, and AP exams. aps replaces the AP list; leave it out to keep the current list.",
    parameters: {
      type: "object",
      properties: {
        sat: { type: "string", description: "Whole number 400-1600, or '—' to clear" }, satNote: str,
        act: { type: "string", description: "ACT composite 1-36, or '—' to clear" },
        aps: {
          type: "array",
          items: { type: "object", properties: { course: str, score: { type: "string", description: "1-5" } }, required: ["course", "score"] },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "set_coursework",
    description: "Replace coursework lists shown on the Profile page. Each list you pass replaces that list.",
    parameters: {
      type: "object",
      properties: {
        honors: { type: "array", items: str },
        aps: { type: "array", items: str },
        senior: { type: "array", items: str, description: "Senior-year / planned courses" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "set_activities",
    description:
      "Replace the whole activities list (Common App order, most important first; up to 10, descriptions up to 150 characters). To add, change or remove one activity, use upsert_activity or remove_activity instead.",
    parameters: {
      type: "object",
      properties: {
        activities: {
          type: "array",
          items: { type: "object", properties: { rank: { type: "number" }, ...activityFields }, required: ["rank", "name", "type"] },
        },
      },
      required: ["activities"],
      additionalProperties: false,
    },
  },
  {
    name: "upsert_activity",
    description:
      "Add one activity or change fields of an existing one. Matches `match` (the current name) or `name` against saved activities; only the fields you pass change. `rank` moves it to that position (1 = most important). Up to 10 activities.",
    parameters: {
      type: "object",
      properties: {
        match: { type: "string", description: "Current name of the activity to change. Leave out to add or match by name." },
        rank: { type: "number" }, ...activityFields,
        college: yesNo("yes: intends to continue in college. no: does not. Leave out to keep."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "remove_activity",
    description: "Remove one activity by name (or by rank). The rest are renumbered.",
    parameters: { type: "object", properties: { name: str, rank: { type: "number" } }, additionalProperties: false },
  },
  {
    name: "set_honors",
    description: "Replace the whole honors & awards list (up to 5). Mark the strongest ones with top:true. To add, change or remove one honor, use upsert_honor or remove_honor instead.",
    parameters: {
      type: "object",
      properties: {
        honors: { type: "array", items: { type: "object", properties: honorFields, required: ["title", "level"] } },
      },
      required: ["honors"],
      additionalProperties: false,
    },
  },
  {
    name: "upsert_honor",
    description: "Add one honor or change an existing one, matched by `match` (the current title) or `title`. Only the fields you pass change. Up to 5 honors.",
    parameters: {
      type: "object",
      properties: {
        match: { type: "string", description: "Current title of the honor to change." }, ...honorFields,
        top: yesNo("yes: one of the strongest honors. no: not. Leave out to keep."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "remove_honor",
    description: "Remove one honor by title.",
    parameters: { type: "object", properties: { title: str }, required: ["title"], additionalProperties: false },
  },
  {
    name: "set_list_preferences",
    description:
      "Save the student's college-list preferences. Only the fields you pass change. ambition: ambitious | balanced | conservative (more reaches or more likely schools). appCount: number of applications, 8-15. regions: northeast, mid-atlantic, south, midwest, west, any. settings: urban, suburban, rural, college-town, any. size: small | medium | large | any. budget: lt15 | 15-30 | 30-50 | 50plus | unsure (thousands of dollars a year). needAid: yes | no (applying for need-based aid). ed: yes | no | maybe (would apply Early Decision). This does not change the saved list; call rebalance_list after, when the student wants the list updated.",
    parameters: {
      type: "object",
      properties: {
        ambition: { type: "string", enum: ["ambitious", "balanced", "conservative"] },
        appCount: { type: "number" },
        regions: { type: "array", items: str }, settings: { type: "array", items: str },
        size: { type: "string", enum: ["small", "medium", "large", "any"] },
        notes: { type: "string", description: "Free-text constraints. Replaces the saved notes." },
        budget: { type: "string", enum: ["lt15", "15-30", "30-50", "50plus", "unsure"] },
        needAid: yesNo("yes: applying for need-based aid. no: not applying."), ed: { type: "string", enum: ["yes", "no", "maybe"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "rebalance_list",
    description:
      "Rebuild the automatic part of the saved college list for the current profile and list preferences. Schools the student or you added, and priority schools, are kept; only schools Forge added automatically are replaced. Ask before calling. Returns what changed and any category that could not be filled.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];

const PROFILE_TOOL_NAMES = new Set(PROFILE_TOOL_SPECS.map((t) => t.name));

class ProfileToolError extends Error {}

function pick(a: Args, keys: string[]): Args {
  return Object.fromEntries(keys.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
}

/** Saves a validated patch. Returns the error text instead of writing when a field is invalid. */
async function savePatch(mutate: Mutate, patch: WorkspacePatch, done: string): Promise<string> {
  const checked = checkWorkspacePatch(patch, "tool");
  if (!checked.ok) return `Not saved: ${checked.error}`;
  await mutate((ws) => applyWorkspacePatch(ws, checked.value));
  return done;
}

/** Runs a list edit inside mutate() so it merges into the latest saved list. */
async function editList(mutate: Mutate, edit: (ws: Workspace) => Parsed<Workspace>, done: () => string): Promise<string> {
  try {
    await mutate((ws) => {
      const r = edit(ws);
      if (!r.ok) throw new ProfileToolError(r.error);
      return r.value;
    });
    return done();
  } catch (error) {
    if (error instanceof ProfileToolError) return `Not saved: ${error.message}`;
    throw error;
  }
}

const withActivities = (ws: Workspace, activities: Workspace["profile"]["activities"]): Workspace =>
  ({ ...ws, profile: { ...ws.profile, activities } });
const withHonors = (ws: Workspace, honors: Workspace["profile"]["honors"]): Workspace =>
  ({ ...ws, profile: { ...ws.profile, honors }, applicant: { ...ws.applicant, awards: honors.length } });

/** Runs a profile tool, or returns null when `name` isn't one. */
export async function runProfileTool(name: string, a: Args, mutate: Mutate): Promise<string | null> {
  if (!PROFILE_TOOL_NAMES.has(name)) return null;
  switch (name) {
    case "set_applicant_snapshot":
      return savePatch(mutate, { applicant: pick(a, ["name", "cycle", "year", "gpaWeighted", "gpaUnweighted", "sat", "satNote"]) }, "Updated the applicant snapshot.");
    case "set_profile_identity":
      return savePatch(mutate, { profile: pick(a, ["intended", "hs", "gradYear", "location", "counselor", "residency"]) }, "Updated profile identity.");
    case "set_testing": {
      // An empty aps array is how some models fill an optional list, so it keeps the saved exams.
      const testing = pick(a, ["sat", "satNote", "act", ...(Array.isArray(a.aps) && a.aps.length ? ["aps"] : [])]);
      return savePatch(mutate, { profile: { testing } }, "Updated testing.");
    }
    case "set_coursework": {
      const coursework = pick(a, ["honors", "aps", "senior"].filter((k) => Array.isArray(a[k])));
      return savePatch(mutate, { profile: { coursework } as WorkspacePatch["profile"] }, "Updated coursework.");
    }
    case "set_activities": {
      if (!Array.isArray(a.activities)) return "set_activities requires an 'activities' array.";
      return savePatch(mutate, { profile: { activities: a.activities } }, `Saved ${a.activities.length} activities.`);
    }
    case "set_honors": {
      if (!Array.isArray(a.honors)) return "set_honors requires a 'honors' array.";
      return savePatch(mutate, { profile: { honors: a.honors } }, `Saved ${a.honors.length} honors.`);
    }
    case "upsert_activity": {
      const { match, college, ...rest } = a;
      const fields: Args = { ...rest, college: toolFlag(college) };
      let reply = "";
      return editList(mutate, (ws) => {
        const r = upsertActivity(ws.profile.activities, fields, typeof match === "string" && match ? match : undefined);
        if (!r.ok) return r;
        const row = r.value.list.find((x) => x.name.trim().toLowerCase() === String(fields.name || match || "").trim().toLowerCase());
        reply = `${r.value.created ? "Added" : "Updated"} the activity${row ? ` "${row.name}" at #${row.rank}` : ""}.`;
        return { ok: true, value: withActivities(ws, r.value.list) };
      }, () => reply);
    }
    case "remove_activity": {
      const key = { name: typeof a.name === "string" && a.name ? a.name : undefined, rank: typeof a.rank === "number" && a.rank ? a.rank : undefined };
      if (!key.name && !key.rank) return "remove_activity requires a name or rank.";
      return editList(mutate, (ws) => {
        const r = removeActivity(ws.profile.activities, key);
        return r.ok ? { ok: true, value: withActivities(ws, r.value) } : r;
      }, () => "Removed the activity.");
    }
    case "upsert_honor": {
      const { match, top, ...rest } = a;
      const fields: Args = { ...rest, top: toolFlag(top) };
      let created = false;
      return editList(mutate, (ws) => {
        const r = upsertHonor(ws.profile.honors, fields, typeof match === "string" && match ? match : undefined);
        if (!r.ok) return r;
        created = r.value.created;
        return { ok: true, value: withHonors(ws, r.value.list) };
      }, () => `${created ? "Added" : "Updated"} the honor.`);
    }
    case "remove_honor": {
      if (typeof a.title !== "string" || !a.title) return "remove_honor requires a title.";
      return editList(mutate, (ws) => {
        const r = removeHonor(ws.profile.honors, a.title as string);
        return r.ok ? { ok: true, value: withHonors(ws, r.value) } : r;
      }, () => "Removed the honor.");
    }
    case "set_list_preferences": {
      const listPrefs = { ...pick(a, ["ambition", "appCount", "regions", "settings", "size", "notes", "budget", "ed"]), needAid: toolFlag(a.needAid) };
      return savePatch(mutate, { listPrefs }, "Saved the list preferences. The saved list is unchanged until rebalance_list runs.");
    }
    case "rebalance_list": {
      let summary = "";
      await mutate((ws) => {
        const { workspace, added, removed, gaps } = rebalanceWorkspace(ws);
        const label = { reach: "reach", target: "target", safety: "likely" } as const;
        summary = [
          `Rebalanced the list: ${workspace.colleges.length} schools.`,
          `Added: ${added.join(", ") || "none"}. Removed: ${removed.join(", ") || "none"}.`,
          gaps.length ? `Could not fill: ${gaps.map((g) => `${g.missing} ${label[g.tier]}`).join(", ")}.` : "",
        ].filter(Boolean).join("\n");
        return syncEssaySupplements(workspace);
      });
      return summary;
    }
    default:
      return null;
  }
}
