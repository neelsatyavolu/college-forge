import type { Arrival } from "../inbox";
import { C, button, callout, escapeHtml, layout } from "./layout";

/**
 * Emails telling the student what happened to a forwarded email. They never contain the password or PIN.
 * Ported from College Apps (worker/src/inbox/mail.ts).
 */

type Email = { subject: string; text: string; html: string };

function compose(subject: string, title: string, lines: string[], appUrl: string, tone?: { title: string; body: string; tone: "waiting" | "hold" }): Email {
  const text = [title, "", ...lines, "", `Open Forge: ${appUrl}`, "", `Forge · ${new URL(appUrl).host}`].join("\n");
  const body = [
    `<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:${C.ink}">${escapeHtml(title)}</h1>`,
    tone ? `<div style="padding:4px 0 12px">${callout(tone.title, tone.body, tone.tone)}</div>` : "",
    ...lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:${C.ink2}">${escapeHtml(l)}</p>`),
    `<div style="padding-top:8px">${button("Open Forge", appUrl)}</div>`,
  ].join("");
  return { subject, text, html: layout({ preheader: lines[0] ?? title, body, appUrl, footer: "You got this because you forwarded an email to your Forge forwarding address." }) };
}

export function arrivalEmail(arrival: Arrival, appUrl: string): Email {
  const where = "The login is saved in Forge, encrypted, and Forge will check this portal for you every 12 hours.";
  if (arrival.state === "verified") {
    return compose(`${arrival.name}: your portal is set up`, `${arrival.name}: your portal is set up`, [
      `We set a new password on your ${arrival.name} portal and signed in with it to make sure it works. The username is ${arrival.username}.`,
      where,
    ], appUrl);
  }
  if (arrival.state === "set") {
    return compose(`${arrival.name}: check your new portal password`, `${arrival.name}: check your new portal password`, [
      `We set a new password on your ${arrival.name} portal, but signing in with it afterwards didn't work.`,
      "Forge saved that password and will try it on its next check. If the check can't sign in, reset the password from the portal's sign-in page and save the new one in Forge.",
    ], appUrl, { title: "Signing in didn't work yet", body: arrival.reason, tone: "hold" });
  }
  return compose(`${arrival.name}: finish setting up your portal`, `${arrival.name}: finish setting up your portal`, [
    `We read the email from ${arrival.name} but couldn't set up the portal for you, so Forge didn't save a new password. The school is on your Portals page.`,
    `Use the link in the school's email${arrival.pin ? " and its PIN" : ""} to choose a password, then save that username and password on ${arrival.name} in Forge so it can check the portal for you.`,
  ], appUrl, { title: "Why it stopped", body: arrival.reason, tone: "hold" });
}

export function notPortalEmail(subject: string, appUrl: string): Email {
  return compose("We couldn't find a portal login in that email", "We couldn't find a portal login in that email", [
    `The email${subject ? ` "${subject.slice(0, 80)}"` : ""} didn't have a temporary PIN or a link to set up an applicant portal account, so nothing was saved.`,
    "Forward the email a school sends after you apply, the one that says how to create or activate your portal account.",
  ], appUrl);
}
