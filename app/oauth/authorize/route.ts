import { NextRequest } from "next/server";
import { APP_REDIRECT_URI, OAuthError, checkAuthorize, consentToken, getClient, issueCode, readConsent } from "@/lib/oauth";
import { getSession } from "@/lib/workspace-cookie";
import { appOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="robots" content="noindex"><title>${esc(title)} · Forge</title>
<link rel="icon" href="/assets/mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500&family=DM+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/oauth.css"></head>
<body><main class="oa">${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "content-security-policy": "frame-ancestors 'none'",
      // Not no-referrer: with it, browsers send "Origin: null" on the Allow form and the check below fails.
      "referrer-policy": "same-origin",
    },
  });
}

const errorPage = (message: string) =>
  page("Can't connect", `<p class="oa__brand">Forge</p><h1>Can't connect this assistant</h1><p class="oa__lede">${esc(message)}</p>`, 400);

function backTo(redirectUri: string, params: Record<string, string>, origin: string): Response {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  u.searchParams.set("iss", origin);
  return new Response(null, { status: 302, headers: { location: u.toString(), "cache-control": "no-store" } });
}

/** Shows who is asking, what it can do, and the account it will act for. */
export async function GET(req: NextRequest) {
  let ar;
  try {
    ar = await checkAuthorize(req.nextUrl.searchParams);
  } catch (err) {
    return errorPage(err instanceof OAuthError ? err.message : "Something went wrong. Try adding the connector again.");
  }
  const session = getSession(req);
  if (!session) {
    const back = `/oauth/authorize?${req.nextUrl.searchParams.toString()}`;
    return new Response(null, { status: 302, headers: { location: `/api/xanom/start?return=${encodeURIComponent(back)}` } });
  }
  const host = new URL(ar.redirect_uri).host || new URL(ar.redirect_uri).protocol;
  const token = consentToken(session.sub, ar);
  if (ar.redirect_uri === APP_REDIRECT_URI) return appConsent(session.email, token);
  return page(
    "Allow access",
    `<p class="oa__brand">Forge</p>
<h1>Let ${esc(ar.client.client_name)} use your applications?</h1>
<p class="oa__lede">It will act for <!--email_off--><strong>${esc(session.email)}</strong><!--/email_off--> until you disconnect it in Forge settings.</p>
<dl class="oa__list">
  <div><dt>It can</dt><dd>See and change your applications page: schools, statuses, deadlines, decision dates, follow-ups, flags, notes and portal checks. Record decisions, and open a decision a portal posted when you ask (which marks it as seen). Create and turn off progress links for parents and counselors (never full advisor links), and read the notes they leave. See your shortlist and profile summary (school, major, GPA and scores). Read your essays, including drafts, and change essay prompts and which essays you're writing (it doesn't rewrite your drafts).</dd></div>
${ar.logins ? `  <div><dt>Passwords</dt><dd>It can also read your saved portal usernames and passwords, for the collegeforge command-line tool on your computer. Only allow this if you just ran <code>collegeforge login</code>.</dd></div>
  <div><dt>It can't</dt><dd>Change portal links or logins, or change your Forge account.</dd></div>` : `  <div><dt>It can't</dt><dd>See your portal passwords, change portal links or logins, or change your Forge account.</dd></div>`}
  <div><dt>Returns to</dt><dd><code>${esc(host)}</code></dd></div>
</dl>
<form method="post" class="oa__actions">
  <input type="hidden" name="consent" value="${esc(token)}">
  <button class="oa__btn oa__btn--primary" name="decision" value="allow" type="submit">Allow</button>
  <button class="oa__btn" name="decision" value="deny" type="submit">Cancel</button>
</form>`,
  );
}

/** The iPhone app gets a full session, so its consent says so plainly. */
function appConsent(email: string, token: string): Response {
  return page(
    "Allow access",
    `<p class="oa__brand">Forge</p>
<h1>Sign in to Forge on your iPhone?</h1>
<p class="oa__lede">The Forge app will have full access to <!--email_off--><strong>${esc(email)}</strong><!--/email_off--> until you sign out or disconnect it in Forge settings.</p>
<dl class="oa__list">
  <div><dt>It can</dt><dd>Do anything you can do in Forge: see and change your profile, colleges, essays and applications, portal links and logins, sharing, connected assistants and settings, and send notifications to your iPhone.</dd></div>
  <div><dt>Only allow</dt><dd>if you just tapped Sign in in the Forge app. No other app or assistant should ask for this.</dd></div>
</dl>
<form method="post" class="oa__actions">
  <input type="hidden" name="consent" value="${esc(token)}">
  <button class="oa__btn oa__btn--primary" name="decision" value="allow" type="submit">Allow</button>
  <button class="oa__btn" name="decision" value="deny" type="submit">Cancel</button>
</form>`,
  );
}

export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return errorPage("Your Forge session ended. Start connecting again from your assistant.");
  // The signed consent token (bound to this session) is the real cross-site guard; this is a second check.
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  const sameSite = fetchSite === "same-origin" || (!!origin && origin !== "null" && (origin === req.nextUrl.origin || origin === appOrigin(req)));
  if ((origin || fetchSite) && !sameSite) return errorPage("That request didn't come from Forge. Start connecting again from your assistant.");
  const form = new URLSearchParams(await req.text());
  const consent = readConsent(form.get("consent") ?? "", session.sub);
  if (!consent) return errorPage("This page expired. Start connecting again from your assistant.");
  const client = await getClient(consent.client_id);
  if (!client || !client.redirect_uris.includes(consent.redirect_uri)) return errorPage("This assistant isn't registered anymore.");
  if (form.get("decision") !== "allow") {
    return backTo(consent.redirect_uri, { error: "access_denied", state: consent.state }, appOrigin(req));
  }
  const code = await issueCode(client, consent.redirect_uri, consent.code_challenge, session.sub, session.workspaceId, { logins: consent.logins });
  return backTo(consent.redirect_uri, { code, state: consent.state }, appOrigin(req));
}
