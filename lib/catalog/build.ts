import { SLATE_EMAIL_PIN, type College, type Platform } from "./types";

/** One school in compact form; everything not given is worked out from the name, domain and portal link. */
export interface Row {
  id: string;
  name: string;
  state: string;
  /** The school's main domain, like "princeton.edu". */
  website: string;
  /** Where an applicant signs in to see their status. */
  portal: string;
  /** Background and text color for the monogram tile. */
  colors: [string, string];
  platform?: Platform;
  portalName?: string;
  howToLogIn?: string;
  /** Other domains the school uses. */
  domains?: string[];
  /** Sign-in and activation hosts beyond the portal itself. */
  hosts?: string[];
  aliases?: string[];
  monogram?: string;
  microsoft?: boolean;
  decisionNote?: string;
  decisions?: College["decisions"];
}

const SKIP = new Set(["of", "at", "the", "and", "in", "for"]);

/** "University of Chicago" is UC, "Rice University" RU, "Ohio State University" OSU, "UC Davis" UCD. */
function monogramOf(name: string): string {
  const words = name.split(/[\s–,.&-]+/).filter((w) => w && !SKIP.has(w.toLowerCase()));
  const letters = words.map((w) => (/^[A-Z]{2,4}$/.test(w) ? w : w[0]!.toUpperCase())).join("");
  return letters.slice(0, 4);
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** School colors often pair two mid tones (gold on maroon); fall back to white or black text so the monogram stays readable. */
export function readableText(bg: string, fg: string): string {
  if (contrast(bg, fg) >= 4.5) return fg;
  return contrast(bg, "#FFFFFF") >= contrast(bg, "#000000") ? "#FFFFFF" : "#000000";
}

const CAMPUS_LOGIN = "Sign in with the account the school set up for you after you applied; the confirmation email says how.";

export function school(row: Row): College {
  const portalHost = new URL(row.portal).hostname;
  const slate = /\/apply\/status\/?$|\/account\/login/.test(new URL(row.portal).pathname);
  const platform = row.platform ?? (slate ? "slate" : "netid-sso");
  // One-word names ("rice", "american", "temple") would match unrelated logins, so short forms need two words.
  const shortName = normalize(row.name.replace(/^University of |^The /, ""));
  const aliases = [...new Set([normalize(row.name), ...(shortName.includes(" ") ? [shortName] : []), ...(row.aliases ?? [])])];
  return {
    id: row.id,
    name: row.name,
    monogram: row.monogram ?? monogramOf(row.name),
    colors: { bg: row.colors[0], fg: readableText(row.colors[0], row.colors[1]) },
    state: row.state,
    website: row.website,
    domains: [row.website, ...(row.domains ?? [])],
    hosts: [portalHost, ...(row.hosts ?? [])],
    aliases,
    portalName: row.portalName ?? (platform === "slate" ? "Applicant Status Portal" : "Applicant Portal"),
    platform,
    loginUrl: row.portal,
    howToLogIn: row.howToLogIn ?? (platform === "slate" ? SLATE_EMAIL_PIN : CAMPUS_LOGIN),
    ...(row.microsoft ? { microsoft: true } : {}),
    ...(row.decisionNote ? { decisionNote: row.decisionNote } : {}),
    ...(row.decisions ? { decisions: row.decisions } : {}),
  };
}
