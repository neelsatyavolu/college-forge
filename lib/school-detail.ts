/**
 * The personalized part of a shortlist school's detail page (public/hub/SchoolDetail.jsx): how the
 * student's intended major fares there, and how their GPA and SAT compare with the school's numbers.
 * Built only from data Forge already has (the U.S. News snapshot and the career-ranking file); a
 * missing number stays missing.
 */
import type { College, Workspace } from "./store";
import { US_NEWS_BY_SCORECARD_ID, US_NEWS_BY_SLUG, type UsNewsCollege } from "./us-news-rankings";
import { assessAcademicFit, studentAcademics, type AcademicFit } from "./college-recommendations";
import careerData from "../public/data/career-ranking.json";
import { majorKeysOf, SWITCH_LABELS, type CareerData } from "./career-ranking";
import { logoUrl } from "./catalog";
import { matchCatalog } from "./tracker";

const CAREER = careerData as unknown as CareerData;
const CAREER_BY_ID = new Map(CAREER.schools.map((s) => [s.id, s]));
const MAJOR_LABEL = new Map(CAREER.meta.majors.map((m) => [m.key, m.label]));

export type Position = "below" | "within" | "above";

export type Comparison = {
  label: "SAT" | "GPA";
  yours: number;
  /** "1350–1520 middle 50%" or "3.9 average (unweighted)". */
  theirs: string;
  position: Position;
  /** The SAT is the student's ACT concorded to the SAT scale. */
  fromAct?: boolean;
};

export type MajorFit = {
  intended: string;
  /** Whether the school graduates students in a matching major; null when Forge has no data for it. */
  offered: boolean | null;
  /** How hard it is to get into each matching major after enrolling, where Forge checked by hand. */
  switching: { major: string; label: string; level: number }[];
  /** False when the career data covers the school but its switching rules were never researched. */
  checked: boolean;
};

export type SchoolInsights = {
  slug: string;
  logo: string | null;
  /** "Urban, 1,000-acre campus" style setting from the U.S. News snapshot. */
  setting: string | null;
  fit: AcademicFit | null;
  comparisons: Comparison[];
  major: MajorFit | null;
};

function usNewsRow(c: College): UsNewsCollege | undefined {
  return (typeof c.scorecardId === "number" ? US_NEWS_BY_SCORECARD_ID.get(c.scorecardId) : undefined) ?? US_NEWS_BY_SLUG.get(c.slug);
}

/** Where a value falls against a range: under its low end, inside it, or over its high end. */
export function positionIn(value: number, low: number, high: number): Position {
  return value < low ? "below" : value > high ? "above" : "within";
}

/** The student's SAT and GPA against the school's SAT middle 50% and average GPA. Missing numbers leave rows out. */
export function compareAcademics(ws: Workspace, school: UsNewsCollege | undefined): Comparison[] {
  if (!school) return [];
  const me = studentAcademics(ws);
  const out: Comparison[] = [];
  // The UCs do not look at SAT/ACT scores, so a score comparison there would mislead.
  const testBlind = school.slug.startsWith("university-of-california-");
  if (!testBlind && me.sat !== null && school.sat25 !== null && school.sat75 !== null) {
    out.push({ label: "SAT", yours: me.sat, theirs: `${school.sat25}–${school.sat75} middle 50%`, position: positionIn(me.sat, school.sat25, school.sat75), ...(me.satFromAct ? { fromAct: true } : {}) });
  }
  // A weighted school average is on another scale than the student's unweighted GPA, so it is not compared.
  if (me.gpa !== null && school.gpa !== null && !school.gpaWeighted) {
    out.push({ label: "GPA", yours: me.gpa, theirs: `${school.gpa} average (unweighted)`, position: me.gpa < school.gpa ? "below" : me.gpa > school.gpa ? "above" : "within" });
  }
  return out;
}

/** What the career-ranking data says about the student's intended major at a school (by Scorecard id). */
export function majorFitFor(unitid: number | undefined, intended: string): MajorFit | null {
  const text = (intended || "").trim();
  if (!text || /^(undecided|exploring|not sure)$/i.test(text)) return null;
  const keys = majorKeysOf(text);
  const school = typeof unitid === "number" ? CAREER_BY_ID.get(unitid) : undefined;
  if (!school || !keys.length) return { intended: text, offered: null, switching: [], checked: false };
  const checked = school.checked !== false;
  const switching = checked
    ? keys
      .map((k) => ({ k, lv: school.switch?.lv?.[k] ?? 0 }))
      .filter(({ lv }) => lv > 0 && SWITCH_LABELS[String(lv)])
      .map(({ k, lv }) => ({ major: MAJOR_LABEL.get(k) ?? k, label: SWITCH_LABELS[String(lv)], level: lv }))
    : [];
  return { intended: text, offered: keys.some((k) => Boolean(school.tracks[k])), switching, checked };
}

/** The detail page's personalized numbers for one school on the student's list, or null when it isn't on the list. */
export function schoolInsights(ws: Workspace, slug: string): SchoolInsights | null {
  const college = ws.colleges.find((c) => c.slug === slug);
  if (!college) return null;
  const school = usNewsRow(college);
  const catalog = matchCatalog(college.name);
  const unitid = typeof college.scorecardId === "number" ? college.scorecardId : school?.scorecardId;
  return {
    slug,
    logo: (catalog && logoUrl(catalog.id)) || null,
    setting: school?.settingDetail || null,
    fit: school ? assessAcademicFit(school, ws) : null,
    comparisons: compareAcademics(ws, school),
    major: majorFitFor(unitid, ws.profile.intended),
  };
}
