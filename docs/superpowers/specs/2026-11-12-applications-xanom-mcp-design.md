# Forge: applications tracker, Xanom accounts, assistant access (MCP)

Date: 2026-11-12. Owner request: merge College Apps (portal status and decisions tracker, collegeapps.n3el.dev)
into Forge as a tab in Forge's own UI, make it easy to move from College Apps into a Forge account, trim Forge
to the features that matter (application status by deadline: not started, submitted, under review, admitted…),
move Forge to forge.xanom.co on Xanom accounts, and add an OAuth MCP server so assistants such as Grok (and
Grok Bot) can read and edit applications and decisions.

## Owner decisions

- Forge lives at **forge.xanom.co**; forge.n3el.dev redirects there. Sign-in is **Xanom accounts** (OIDC).
- Tracker data (statuses, rounds, deadlines, decisions, notes) is **readable by the server**, like the rest of
  a Forge workspace, so the MCP server can serve it. Portal **passwords stay encrypted** at rest with a server key
  and are never returned to the browser, the AI copilot, share links, exports or MCP.
- "Just make it work": the remaining calls below are the builder's.

## Approaches considered

1. **Forge UI + Forge storage, College Apps worker kept as the portal sign-in engine (chosen).** The tracker
   becomes part of the Forge workspace (Vercel Blob). Portal checks call a new service-only endpoint on the
   collegeapps Worker, which already knows how to sign in to 330 portals. Its hourly Cloudflare cron also pings
   Forge to run due checks (Vercel cron on this plan is daily only).
2. Port the sign-in engine into Next.js. Rejected: thousands of lines of tested portal adapters to duplicate.
3. Keep College Apps separate and embed it. Rejected: two accounts, two UIs, and its end-to-end encryption rules
   out server-side MCP.

## What gets built

- **Accounts.** `/api/xanom/start|callback|logout|summary` per the Xanom spec. A signed `forge_session` cookie
  maps a Xanom `sub` to one workspace (`accounts/<sub>.json`). On first sign-in, the browser's existing anonymous
  workspace is attached to the account, so nothing is lost. forge.n3el.dev hands its workspace cookie to
  forge.xanom.co through a short-lived signed link. The hub shows a sign-in screen when signed out.
- **Applications tab** (new home). Every school with status, round, deadline, decision date (exact, from the
  portal, or estimated from last cycle), what the portal says, missing items, notes and saved portal login.
  Grouped by stage, or listed by date. "Check portals" runs checks now; automatic checks every 12 hours are on
  by default once a login is saved. Schools come from College Apps' 330-school catalog (logos included) or any
  name/link. Shortlist schools get "Track application".
- **Decisions tab.** A posted decision stays hidden until the student clicks to reveal it, as in College Apps.
- **Import from College Apps.** On the Applications tab: College Apps email + password, sent once to Forge's
  server, which derives the College Apps keys, signs in, decrypts the vault, imports schools and logins, signs
  out and keeps nothing else. College Apps gets a "Move to Forge" link.
- **Cleanup.** Removed: Overview, Compare, Scattergrams (+ Maia import), Application plan, Dates & deadlines
  (folded into the Applications date view), recovery codes (accounts replace them). Setup wizard no longer
  blocks the hub; it is reachable from "Colleges for you". Share links and exports move into Settings.
- **MCP.** Streamable HTTP at `https://forge.xanom.co/mcp`. Forge is its own OAuth 2.1 authorization server
  (protected-resource + AS metadata, dynamic client registration, PKCE S256, rotating refresh tokens); the user
  signs in with Xanom and approves on a consent page. Tools: list/get/add/update/remove applications, record or
  reveal decisions, upcoming dates, check portals, read the shortlist and profile summary. Passwords never exposed.
  Settings shows the URL with copy buttons and lists connected assistants with "Disconnect".

## Non-goals

- Shutting down College Apps (it keeps working; it links to Forge).
- Family sharing and email forwarding from College Apps (advisor share links cover read-only sharing).
- Change emails from automatic checks (later, through Resend, if wanted).

## Left to the builder

File layout, exact copy, visual details within Forge's existing design system.
