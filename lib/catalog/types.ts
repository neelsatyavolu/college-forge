/**
 * A school the app knows. `hosts` are where a password manager may have saved the portal login (the
 * portal plus its campus sign-in and account-activation sites); `domains` catch anything else on the
 * school's site. Decision timing is what the school published for the last cycle, so it's a guide, not a promise.
 */
export interface College {
  id: string;
  name: string;
  monogram: string;
  colors: { bg: string; fg: string };
  state: string;
  website: string;
  domains: string[];
  hosts: string[];
  /** Lowercase words a login's title might use for this school. */
  aliases: string[];
  portalName: string;
  platform: Platform;
  loginUrl: string;
  howToLogIn: string;
  /** Applicants sign in with the school's own Microsoft account, so the password goes to login.microsoftonline.com. */
  microsoft?: boolean;
  decisionNote?: string;
  /**
   * When decisions came out last cycle, by round, as "MM-DD". Used as an estimate only when the portal
   * doesn't state a date. Where in-state and out-of-state dates differ, this is the later (out-of-state) one.
   */
  decisions?: Partial<Record<"ED" | "ED2" | "EA" | "REA" | "RD", string>>;
}

export type Platform = "slate" | "netid-sso" | "asurite-sso" | "psu-sso" | "salesforce" | "custom" | "other";

export const PLATFORM_LABEL: Record<string, string> = {
  slate: "Slate",
  "netid-sso": "Campus sign-in",
  "asurite-sso": "ASURITE sign-in",
  "psu-sso": "Penn State sign-in",
  salesforce: "Salesforce portal",
  custom: "School's own system",
  other: "Other",
};

export const SLATE_EMAIL_PIN = "Sign in with the email you applied with. First time: use the PIN or link from the confirmation email to set a password.";
