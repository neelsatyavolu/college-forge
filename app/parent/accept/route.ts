import { NextRequest } from "next/server";
import { getSession } from "@/lib/workspace-cookie";
import { ownerOf } from "@/lib/session";
import { getWorkspace } from "@/lib/store";
import { appOrigin } from "@/lib/origin";
import { ParentError, acceptInvite, levelOf, readInvite, roleOf, wrongAccount } from "@/lib/parents";
import { PARENT_LEVEL_INFO } from "@/lib/parent-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The link in a parent or counselor invite. Opening it never accepts anything (mail scanners open links too):
 * a signed-in parent or counselor sees who invited them and what they'll see, and accepts with a button.
 */

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
      "referrer-policy": "same-origin",
    },
  });
}

const problem = (message: string, status = 400) =>
  page("Invite", `<p class="oa__brand">Forge</p><h1>This invite can't be used</h1><p class="oa__lede">${esc(message)}</p>
<div class="oa__actions"><a class="oa__btn" href="/hub/index.html" style="display:inline-flex;align-items:center;text-decoration:none">Open Forge</a></div>`, status);

const EXPIRED = "It has expired or was already used. Ask your student to send a new one from Forge.";

const firstName = (name: string) => (name || "").trim().split(/\s+/)[0] || "Your student";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const invite = await readInvite(token).catch(() => null);
  if (!invite) return problem(EXPIRED, 404);
  const name = firstName((await getWorkspace(invite.workspaceId)).applicant.name);
  const role = roleOf(invite.link);
  const counselor = role === "counselor";
  const coach = role === "coach";
  const sees = PARENT_LEVEL_INFO[levelOf(invite.link)];
  const back = `/parent/accept?t=${encodeURIComponent(token)}`;
  const session = getSession(req);
  const intro = `<p class="oa__brand">Forge</p>
<h1>${esc(name)} invited you ${counselor ? "to be their college counselor" : coach ? "to be their essay writing coach" : "to follow their college applications"}</h1>
<dl class="oa__list">
  <div><dt>You'll see</dt><dd>${esc(sees.forParent.charAt(0).toUpperCase() + sees.forParent.slice(1))}.</dd></div>
  ${coach
    ? `<div><dt>You can't</dt><dd>Edit their drafts, or see their applications, college list, profile or decisions. ${esc(name)} can remove you at any time.</dd></div>`
    : `<div><dt>Level</dt><dd>${esc(sees.label)}. ${esc(name)} can change it or remove you at any time.</dd></div>
  ${counselor ? `<div><dt>You can</dt><dd>Leave ${esc(name)} notes, in general or on an essay you can see.</dd></div>\n  ` : ""}<div><dt>You can't</dt><dd>${counselor ? "Change their applications" : "Change anything"}, see portal passwords, or see a decision before ${esc(name)} opens it.</dd></div>`}
</dl>`;
  if (!session) {
    return page("Invite", `${intro}
<p class="oa__lede">Sign in, or create a free account, with the email this invite was sent to. Use the same account later in the Forge iPhone app.</p>
<div class="oa__actions"><a class="oa__btn oa__btn--primary" href="/api/xanom/start?return=${encodeURIComponent(back)}" style="display:inline-flex;align-items:center;text-decoration:none">Sign in or create an account</a></div>`);
  }
  if ((await ownerOf(invite.workspaceId)) === session.sub) {
    return page("Invite", `${intro}
<p class="oa__lede">You're signed in as <!--email_off--><strong>${esc(session.email)}</strong><!--/email_off-->, the student who sent this invite. Send the link to your ${coach ? "writing coach" : role} instead, or switch accounts.</p>
<div class="oa__actions"><a class="oa__btn" href="/api/xanom/start?prompt=login&return=${encodeURIComponent(back)}" style="display:inline-flex;align-items:center;text-decoration:none">Use another account</a></div>`);
  }
  if (session.email.trim().toLowerCase() !== invite.link.email) {
    return page("Invite", `${intro}
<p class="oa__lede">You're signed in as <!--email_off--><strong>${esc(session.email)}</strong><!--/email_off-->. ${esc(wrongAccount(invite.link.email))}</p>
<div class="oa__actions"><a class="oa__btn oa__btn--primary" href="/api/xanom/start?prompt=login&return=${encodeURIComponent(back)}" style="display:inline-flex;align-items:center;text-decoration:none">Use another account</a></div>`);
  }
  return page("Invite", `${intro}
<p class="oa__lede">You'll accept as <!--email_off--><strong>${esc(session.email)}</strong><!--/email_off-->.</p>
<form method="post" class="oa__actions">
  <input type="hidden" name="t" value="${esc(token)}">
  <button class="oa__btn oa__btn--primary" type="submit">Accept invite</button>
  <a class="oa__btn" href="/api/xanom/start?prompt=login&return=${encodeURIComponent(back)}" style="display:inline-flex;align-items:center;text-decoration:none">Use another account</a>
</form>`);
}

export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return problem("Your sign-in ended. Open the invite link again.", 401);
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  const sameSite = fetchSite === "same-origin" || (!!origin && origin !== "null" && (origin === req.nextUrl.origin || origin === appOrigin(req)));
  if ((origin || fetchSite) && !sameSite) return problem("That request didn't come from Forge. Open the invite link again.", 403);
  const token = new URLSearchParams(await req.text()).get("t") ?? "";
  const invite = await readInvite(token).catch(() => null);
  if (!invite) return problem(EXPIRED, 404);
  try {
    await acceptInvite(token, { sub: session.sub, email: session.email, name: session.name }, await ownerOf(invite.workspaceId));
  } catch (err) {
    if (err instanceof ParentError) return problem(err.message);
    console.error("parent accept failed", err instanceof Error ? err.name : "unknown");
    return problem("Something went wrong. Try the link again.", 500);
  }
  const name = firstName((await getWorkspace(invite.workspaceId)).applicant.name);
  const role = roleOf(invite.link);
  if (role === "coach") {
    return page("You're in", `<p class="oa__brand">Forge</p>
<h1>You're ${esc(name)}'s writing coach</h1>
<p class="oa__lede">Open ${esc(name)}'s essays here, signed in with <!--email_off--><strong>${esc(session.email)}</strong><!--/email_off-->.</p>
<div class="oa__actions"><a class="oa__btn oa__btn--primary" href="/hub/index.html?view=parent" style="display:inline-flex;align-items:center;text-decoration:none">Open essays</a></div>`);
  }
  const board = role === "counselor" ? "counselor dashboard" : "parent dashboard";
  return page("You're in", `<p class="oa__brand">Forge</p>
<h1>You're following ${esc(name)}'s applications</h1>
<p class="oa__lede">Open your ${board} here, or sign in to the Forge iPhone app with <!--email_off--><strong>${esc(session.email)}</strong><!--/email_off-->.</p>
<div class="oa__actions"><a class="oa__btn oa__btn--primary" href="/hub/index.html?view=parent" style="display:inline-flex;align-items:center;text-decoration:none">Open ${board}</a></div>`);
}
