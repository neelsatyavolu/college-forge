/**
 * The required checklist for the onboarding interview. A field counts as answered because the
 * workspace holds it, not because a question was asked, so typed answers, tiles and a transcript
 * all satisfy it the same way. Values Codex fills by default (0, "", "—") count as missing.
 */
import type { InterviewSection, InterviewState, Workspace } from "./store";
import { isNotYetTestedNote, isTestOptionalNote } from "./colleges";

export const SECTIONS: InterviewSection[] = ["basics", "school", "testing", "activities", "campus", "money", "early", "deep"];
export const DEEP_MIN = 3;

export const SECTION_LABELS: Record<InterviewSection, string> = {
  basics: "Basics",
  school: "School & grades",
  testing: "Testing",
  activities: "Activities",
  campus: "Campus",
  money: "Money",
  early: "Your list",
  deep: "Deeper",
};

const has = (v: unknown): boolean => {
  if (typeof v === "number") return v > 0;
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t !== "" && t !== "—" && t !== "-" && t !== "0";
};

/** Activities kept to this many, in rank order, must have enough detail to recommend from. */
export const TOP_ACTIVITIES = 3;
/** A description shorter than this says what the activity is, not what the student did. */
export const MIN_ACTIVITY_DESC = 40;

/** Names of the top activities missing a role, weekly hours or a real description. */
export function thinActivities(activities: { rank?: number; name: string; role?: string; hpw?: string; desc?: string }[]): string[] {
  return [...activities]
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .slice(0, TOP_ACTIVITIES)
    .filter((a) => !has(a.role) || !has(a.hpw) || (a.desc ?? "").trim().length < MIN_ACTIVITY_DESC)
    .map((a) => a.name);
}

/** "Undecided", "not sure", "no clue"… (and an empty major). */
export function isUndecided(intended: string | undefined): boolean {
  const t = (intended ?? "").trim().toLowerCase();
  return !t || t === "—" || /\b(undecided|not sure|unsure|no idea|no clue|don'?t know|idk|exploring|open)\b/.test(t);
}

export function startInterview(now: number): InterviewState {
  return { phase: "interview", section: "basics", transcript: [], notes: {}, deep: [], startedAt: now };
}

/** Human-readable required fields still missing in one section. */
export function missingFields(ws: Workspace, section: InterviewSection): string[] {
  const p = ws.profile;
  const prefs = ws.onboarding.listPrefs;
  const iv = ws.onboarding.interview;
  const out: string[] = [];
  switch (section) {
    case "basics":
      if (!has(ws.applicant.name)) out.push("name");
      // The high school's name helps but isn't needed for a list, so a student who'd rather not say can go on.
      if (!has(p.gradYear)) out.push("graduation year");
      if (!has(p.intended)) out.push('intended major (or "Undecided")');
      if (!has(p.residency) && prefs?.citizenship !== "international") out.push("state of residence");
      if (!prefs?.citizenship) out.push("citizenship (or not sure)");
      break;
    case "school": {
      const readTranscript = ws.uploads.length > 0 && (p.coursework.aps.length + p.coursework.honors.length + p.coursework.senior.length) > 0;
      if (!has(ws.applicant.gpaUnweighted) && !readTranscript) out.push("unweighted GPA or a transcript");
      // A GPA means little until Forge knows the school's scale (4.33, 100-point…) it was converted from.
      if ((has(ws.applicant.gpaUnweighted) || has(ws.applicant.gpaWeighted)) && !has(ws.applicant.gpaScale)) out.push("the high school's grading scale (4.0, 4.33, 100-point…)");
      break;
    }
    case "testing": {
      const notes = [ws.applicant.satNote, p.testing.satNote];
      const answered = notes.some((n) => isTestOptionalNote(n) || isNotYetTestedNote(n));
      if (!answered && !has(ws.applicant.sat) && !has(p.testing.sat) && !has(p.testing.act)) out.push("SAT, ACT, test-optional, or a note that they haven't tested yet");
      break;
    }
    case "activities":
      if (p.activities.length === 0 && !iv?.noActivities) out.push('at least one activity (or "none yet")');
      // A list is only as good as what Forge knows: the top activities need a role, hours and what they did.
      const thin = thinActivities(p.activities);
      if (thin.length && !iv?.activityDetailsDeclined) out.push(`details (role, hours a week, what they did) for ${thin.join(", ")}`);
      // An undecided student is offered the find-your-major quiz here, once activities show what they do.
      if (isUndecided(p.intended) && !iv?.majorFinder) out.push("offer the find-your-major quiz (suggest_majors), or record that they declined it");
      break;
    case "campus":
      if (!prefs?.settings?.length) out.push("campus setting");
      if (!has(prefs?.size)) out.push("school size");
      if (!prefs?.regions?.length) out.push("regions");
      break;
    case "money":
      if (!prefs?.budget) out.push("yearly budget");
      if (typeof prefs?.needAid !== "boolean") out.push("need-based aid yes/no");
      if (!prefs?.incomeBracket) out.push("family income range (or not sure)");
      break;
    case "early":
      if (!prefs?.ambitionChosen) out.push("reach / target / likely mix");
      if (typeof prefs?.suppCount !== "number") out.push("how many schools with supplements");
      if (typeof prefs?.noSuppCount !== "number") out.push("how many schools without supplements");
      if (!prefs?.ed) out.push("Early Decision stance");
      break;
    case "deep": {
      const left = DEEP_MIN - (iv?.deep.length ?? 0);
      if (left > 0) out.push(`${left} more deeper answer${left === 1 ? "" : "s"}`);
      break;
    }
  }
  return out;
}

/** The first section with required fields missing, or null when the interview can move to the list. */
export function firstIncomplete(ws: Workspace): InterviewSection | null {
  return SECTIONS.find((s) => missingFields(ws, s).length > 0) ?? null;
}
