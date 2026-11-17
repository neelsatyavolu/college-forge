# Retire College Apps into Forge: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forge becomes the only place students track portals. It sends its own portal-change emails, runs the forwarded-email inbox and ships the CLI. collegeapps.n3el.dev stops its own checks and emails and redirects to Forge. Its worker stays up only as the portal engine Forge calls.

**Architecture:** Forge (Next.js on Vercel, repo `forge`) owns all student data, emails and UI. The College Apps Worker (Cloudflare, repo `~/Documents/GitHub/collegeapps`) keeps three jobs behind the `FORGE_SERVICE_KEY` bearer secret: portal sign-in checks (`/api/service/check`, already live), receiving inbox mail and activating portals (new, reports to Forge), and the hourly cron ping to Forge. Forge sends email through Resend directly; nothing student-facing stays on the worker.

**Tech Stack:** Next.js route handlers, Vercel Blob doc-store (`lib/doc-store.ts`), zod, Resend HTTP API, `node:test` (`tests/*.test.cjs`) in Forge; Hono, D1 and vitest in College Apps; esbuild for the CLI bundle.

**Spec:** Decisions made with the user on 2026-11-16 (this conversation):
1. Port portal-change emails to Forge, with an off switch.
2. collegeapps.n3el.dev redirects to Forge. Its own checks and emails stop. Only the APIs Forge uses stay: check service, hourly ping, and the sign-in plus vault read that "Bring your schools over" uses.
3. Bring over the forwarded-email inbox and the CLI.
4. The CLI may read back saved portal passwords (`creds`, `1password`). The web app and MCP still never show them.
5. Send one email to College Apps users who haven't moved. Show the user the text and the count before sending.

Trigger: on 2026-11-16 College Apps emailed "Decision received" for UB at 4:07 PM, while Forge's 3:59 PM check came before UB posted. Two checkers on different schedules disagreed.

## Global Constraints

- Repo is public (MIT): no secrets, `.env*`, student data or real portal content in commits, fixtures or tests. Run `gitleaks git .` before every push (both repos).
- Server `fetch` targets fixed hosts only: `https://api.resend.com`, `https://collegeapps.n3el.dev`, `https://forge.xanom.co`.
- Never log tokens, passwords, inbox addresses, email bodies or portal text. Log error names only (existing pattern).
- Emails never name a decision. Use the existing wording "Decision received" / "Open your portal to see it." (`DECISION_RECEIVED` in `lib/tracker.ts`).
- Sender: `Forge <no-reply@n3el.dev>` (n3el.dev is already verified on Resend for College Apps). Secret `RESEND_API_KEY` goes in the "Forge secrets" 1Password item and on Vercel, never in files.
- Prose follows `~/ANTI AI WRITING.md`. UI follows Forge's existing hub styles; no new design system.
- Do not switch off College Apps checks (Task 7) until Tasks 1–3 are deployed and a real email has been received from Forge.

## Review Focus

1. **A failed check after a good one** (Duo prompt, portal down) must not email "decision received" or re-email old news. A "problem" email goes out only for student-fixable codes (`signin`, `mfa`, `sso`, `not_slate`) and only once per new code. Owner: Task 1 tests.
2. **Anonymous workspaces** (no `workspace-owner` doc) and accounts with no email must be skipped silently, not crash the sweep. Owner: Task 2 test `skips workspaces without an owner`.
3. **Manual "Check now"** must not email (the student is looking at the screen), and its result must not count as "seen" in a way that suppresses the next sweep's email for a change it didn't show. Use the stored notify state, not `app.portal`, as the baseline. Owner: Task 2 test `manual check updates baseline without sending`.
4. **Inbox token guessing / replay:** an unknown token, or one whose workspace turned forwarding off, is rejected by the worker. The arrival endpoint is idempotent by `arrivalId`. Owner: Task 4 tests.
5. **CLI password scope leaking to assistants:** an MCP client that never asked for `logins` scope gets 403 from `/api/cli/logins`. The consent page states the password access in plain words when it's requested. Owner: Task 5 tests.

---

## File Structure

**Forge**
- Create `lib/email.ts`: `sendEmail(to, {subject,text,html})` via Resend. Prints instead when `DEV_EMAIL=1`.
- Create `lib/notify/layout.ts`: port of College Apps `worker/src/emailLayout.ts` (`C`, `button`, `callout`, `escapeHtml`, `layout`), relabelled Forge.
- Create `lib/notify/changes.ts`: port of College Apps `worker/src/notify.ts` (`CheckState`, `Change`, `stateAfter`, `changesBetween`, `composeEmail`), taking Forge's `PortalResult` + error code.
- Create `lib/notify/send.ts`: per-workspace state store, recipient lookup, daily cap, unsubscribe tokens.
- Modify `lib/portal-check.ts`: carry the service error `code`; `runChecks(..., { notify })`.
- Modify `app/api/cron/portal-checks/route.ts`: pass `notify: true`.
- Modify `lib/tracker.ts`: `Tracker.emails: boolean` (default `true`).
- Modify `app/api/applications/route.ts`: actions `emails`, `inbox`.
- Create `app/api/notify/unsubscribe/route.ts`.
- Create `lib/inbox.ts` and `app/api/service/inbox/route.ts`: address tokens and arrival handling.
- Create `app/api/cli/logins/route.ts`; modify `lib/oauth.ts` and the consent page in `app/oauth/authorize/route.ts` for the `logins` scope.
- Create `cli/` (port of College Apps `cli/`), `scripts/build-cli.mjs`, `public/install.sh`.
- Modify `public/hub/Applications.jsx` (email switch, inbox panel), `public/hub/Settings.jsx` if the switch fits better there.
- Modify `lib/collegeapps-import.ts`: record `collegeapps-moved/<sha256(email)>` on a successful import.
- Tests: `tests/notify.test.cjs`, `tests/inbox.test.cjs`, `tests/cli-logins.test.cjs`, plus additions to `tests/applications.test.cjs`.

**College Apps**
- Modify `worker/src/service.ts`: 422 body gains `code`; new `POST /api/service/inbox-ping` is not needed (worker calls Forge, not the reverse).
- Modify `worker/src/index.ts`: `email()` routes to Forge inbox flow; `scheduled()` stops `enqueueDue`; non-API paths redirect; API allowlist.
- Create `worker/src/forgeInbox.ts`: the Forge-backed inbox flow, reusing `inbox/read.ts`, `inbox/activate.ts`.
- Create `scripts/notify-moved.ts`: one-off announcement, dry-run by default.
- Replace `web/public/install.sh` with a stub pointing to Forge's installer.

---

### Task 1: Portal-change detection and email content in Forge

**Files:**
- Create: `lib/notify/layout.ts`, `lib/notify/changes.ts`, `lib/email.ts`
- Test: `tests/notify.test.cjs`

**Interfaces:**
- Produces:
  - `type CheckErrorCode = "signin" | "mfa" | "sso" | "not_slate" | "unreachable" | "other"`
  - `type CheckOutcome = { ok: true; result: PortalResult } | { ok: false; code: CheckErrorCode; message: string }`
  - `stateAfter(prev: CheckState | null, outcome: CheckOutcome): CheckState`, same semantics as College Apps `notify.ts:43`.
  - `changesBetween(prev: CheckState | null, next: CheckState, message?: string): Change[]`, same semantics as College Apps `notify.ts:76`.
  - `composeEmail(school: string, changes: Change[], appUrl: string, extras: { portalUrl?: string; unsubscribeUrl: string }): { subject: string; text: string; html: string }`
  - `sendEmail(to: string, email: { subject: string; text: string; html: string }): Promise<void>` (throws `Error("RESEND_API_KEY is not set")` when missing, unless `DEV_EMAIL=1`)

- [ ] **Step 1: Port College Apps' notify tests.** Copy the cases from College Apps `scripts/smoke-notify.ts` and its vitest notify tests into `tests/notify.test.cjs`, adapted to `CheckOutcome`. Must include:
  - `first check sets a baseline without changes` → `changesBetween(null, stateAfter(null, ok(checklistOnly)))` deep-equals `[]`
  - `first check with a decision already up reports it` → `[{ kind: "decision" }]`
  - `update text appearing reports a decision`: prev `update:""`, next result `update:"Reply to Offer of Admission"` → includes `{ kind: "decision" }`
  - `same update twice reports nothing`
  - `unreachable after ok keeps the old state and reports nothing`
  - `mfa after ok reports one problem, a second mfa reports nothing`
  - `email subject and body never contain the portal's decision words`: compose with a decision change and assert `!/admit|accept|congratulations|denied|waitlist/i.test(subject + text + html)`
  - `email includes the unsubscribe link`
- [ ] **Step 2: Run** `node --test tests/notify.test.cjs`. Expected: FAIL (modules missing).
- [ ] **Step 3: Port** `emailLayout.ts` → `lib/notify/layout.ts` and `notify.ts` → `lib/notify/changes.ts`. Footer text: "You get these emails because automatic checks are on in Forge. Turn them off: <unsubscribeUrl>". Brand line "Forge · forge.xanom.co". Port `DECISION_STATUS`/`revealsDecision` usage from `lib/tracker.ts` (already present) rather than copying College Apps' parse module.
- [ ] **Step 4: Write** `lib/email.ts` (port of College Apps `worker/src/email.ts:10-22`, `FROM = "Forge <no-reply@n3el.dev>"`, reads `process.env.RESEND_API_KEY`).
- [ ] **Step 5: Run** `node --test tests/notify.test.cjs`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: portal-change emails: change detection and email content`

### Task 2: Send emails from the automatic sweep

**Files:**
- Create: `lib/notify/send.ts`, `app/api/notify/unsubscribe/route.ts`
- Modify: `lib/portal-check.ts` (`callService`, `checkApp`, `runChecks`), `app/api/cron/portal-checks/route.ts:39`, `lib/tracker.ts` (`Tracker.emails`, `emptyTracker`, normalizer), `app/api/applications/route.ts` (action `emails`), `public/hub/Applications.jsx:301` (second checkbox "Email me when a portal changes")
- Modify (College Apps): `worker/src/service.ts`, so the 422 JSON is `{ error, code }` with `code` from `PortalError.code`
- Test: `tests/notify.test.cjs` (add), `tests/applications.test.cjs` (add)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  - `PortalResult` gains optional `code?: CheckErrorCode` on failures (from the service 422 body; `"other"` for anything else).
  - `runChecks(workspaceId, opts: { appIds?; onlyDue?; concurrency?; notify?: boolean })`
  - `notifyChanges(workspaceId: string, outcomes: Map<string, { app: TrackedApp; outcome: CheckOutcome }>, opts: { send: boolean; now?: number }): Promise<number>` (number of emails sent). State lives in doc `notify-state/<workspaceId>.json` as `Record<appId, CheckState>`, encrypted with `PORTAL_LOGINS_KEY` using the same helper `lib/portal-logins.ts` uses.
  - `recipientOf(workspaceId): Promise<string | null>` = `ownerOf` → `getAccount(sub).email`.
  - `unsubscribeToken(workspaceId): string` / `readUnsubscribeToken(t): string | null`: HMAC-SHA256 with `SESSION_SECRET`, no expiry.
  - `GET /api/notify/unsubscribe?t=` sets `tracker.emails = false` and returns a small HTML page "Forge won't email you about portal changes. Turn it back on in Applications." Always 200 with the same page for a bad token (no oracle).
  - Daily cap: 20 emails per workspace per UTC day (`MAX_EMAILS_PER_DAY`, matching College Apps).

- [ ] **Step 1: Write failing tests**
  - `sweep emails the owner when a decision appears`: stub `globalThis.fetch` for `api.resend.com`, seed owner + account email, two runs (baseline, then update text). Assert exactly one Resend call to the account email whose subject equals Task 1's decision subject.
  - `manual check updates baseline without sending`: `runChecks(id, { appIds:[a], notify:false })` with the decision, then `runChecks(id, { onlyDue:true, notify:true })` with the same snapshot. Assert zero Resend calls.
  - `skips workspaces without an owner`: no `workspace-owner` doc → no throw, zero sends.
  - `emails off sends nothing`: `tracker.emails=false`.
  - `failed send keeps the old state so the next sweep retries` (same rule as College Apps `autocheck.ts` "the summary moves on only once the student has been told").
  - `unsubscribe link turns emails off`; `bad unsubscribe token changes nothing and returns 200`.
  - `applications action emails toggles tracker.emails`.
- [ ] **Step 2: Run** `node --test tests/notify.test.cjs tests/applications.test.cjs`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the interfaces above. `runChecks` builds the outcome per app alongside `results`, saves the workspace as today, then calls `notifyChanges(..., { send: !!opts.notify && tracker.emails })`. Baseline state is always updated, even when not sending.
- [ ] **Step 4: College Apps service code.** Add `code` to the 422 JSON in `worker/src/service.ts`. Add a vitest case to `test/service.test.ts`: `422 carries the PortalError code`. Run `npm test` in collegeapps. Expected: PASS.
- [ ] **Step 5: Run** `npm test` in forge. Expected: PASS.
- [ ] **Step 6: Commit** each repo: `feat: email students when an automatic check finds something new` (forge) and `feat: service check errors carry their code` (collegeapps).

### Task 3: Deploy emails and verify on a real account

- [ ] **Step 1:** Copy the College Apps `RESEND_API_KEY` into the "Forge secrets" 1Password item and set it on Vercel production (`vercel env add RESEND_API_KEY production`, value piped from `op read`, never echoed).
- [ ] **Step 2:** Deploy collegeapps (`npm run deploy`), then push forge to main (Vercel deploys). Run `gitleaks git .` in both first.
- [ ] **Step 3:** Trigger the sweep once with `CRON_SECRET` (`POST https://forge.xanom.co/api/cron/portal-checks`). Expected JSON `{ workspaces, checked, ms }`, no 5xx in `get_runtime_errors`.
- [ ] **Step 4:** Confirm the owner's workspace has a `notify-state/` doc and that a test change reaches the inbox. Use a disposable Xanom test account with a synthetic, non-catalog Slate stub if no real change is pending. Delete the test account and data afterwards.

### Task 4: Forwarded-email inbox in Forge

**Files:**
- Create: `lib/inbox.ts`, `app/api/service/inbox/route.ts`, `lib/notify/inbox-mail.ts` (port of College Apps `worker/src/inbox/mail.ts`)
- Modify: `app/api/applications/route.ts` (action `inbox`: `{ on: boolean; newAddress?: boolean; birthdate?: string }`), `public/hub/Applications.jsx` (panel "Forward portal emails" showing the address, copy button, birthdate field, new-address button)
- Create (College Apps): `worker/src/forgeInbox.ts`; modify `worker/src/index.ts` `email()`
- Test: `tests/inbox.test.cjs`; College Apps `test/forgeInbox.test.ts`

**Interfaces:**
- Forge storage: `inbox/<token>.json` → `{ workspaceId }`; `inbox-profile/<workspaceId>.json` → `{ token, birthdate }` encrypted with `PORTAL_LOGINS_KEY`. Token: 20 chars `[a-z0-9]` (as College Apps `newToken`). Address: `<token>@collegeapps.n3el.dev` (Email Routing already sends that domain to the worker).
- `POST /api/service/inbox` (bearer `FORGE_SERVICE_KEY`, constant-time compare like `app/api/cron/portal-checks/route.ts:12-17`), body is a zod union:
  - `{ op: "lookup", token }` → `200 { email, birthdate, allowed }` or `404`. `allowed=false` once the address has had 20 emails that UTC day (counter in `inbox-profile`).
  - `{ op: "arrival", token, arrivalId: uuid, arrival: Arrival }` → upserts by `arrivalId`. Adds the school if missing (`collegeId` or name), sets `portalUrl`, saves the login via `saveLogins` with `host` = portal host, and stores a non-secret note "Set up by forwarded email: <state reason>". On the final (non-placeholder) arrival it emails the student `arrivalEmail` (ported, links to Forge). Returns `200 { ok: true }`.
  - `{ op: "not-portal", token, subject }` → emails `notPortalEmail`.
- `Arrival` type: copy of College Apps `web/src/lib/arrival.ts`.
- Worker `receiveForgeEmail(env, message, fetcher?)`: same checks as `inbox/index.ts:62-160` (domain, token regex, size, parse), but it calls Forge `lookup` instead of D1. It posts the placeholder arrival before `activate()` and the final one after, and never stores anything. Env: `FORGE_URL` (fixed `https://forge.xanom.co`), `FORGE_SERVICE_KEY`.

- [ ] **Step 1: Write failing Forge tests:** `service inbox rejects a missing or wrong bearer` (401), `lookup of unknown token is 404`, `arrival adds the school and saves the login without putting the password in the workspace doc`, `same arrivalId twice keeps one school and one login`, `21st email in a day is not allowed`, `turning the inbox off deletes the token doc`.
- [ ] **Step 2: Run** `node --test tests/inbox.test.cjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the Forge side.
- [ ] **Step 4: Write failing worker tests** (vitest, stub fetch for Forge): `unknown token rejects with "There's no such address."`, `placeholder arrival is posted before activate runs`, `non-portal email posts not-portal`.
- [ ] **Step 5: Implement** `forgeInbox.ts` and route `email()` to it.
- [ ] **Step 6: Run** both suites. Expected: PASS.
- [ ] **Step 7: Commit** both repos: `feat: forwarded-email inbox in Forge, handled by the portal engine`.

### Task 5: `collegeforge` CLI against Forge

The command is `collegeforge`, not `forge`: Foundry already installs a `forge` binary.

**Files:**
- Create: `cli/{main,api,args,errors,format,onepassword,prompt,session}.ts` (ported from College Apps `cli/`, with vault crypto removed), `scripts/build-cli.mjs`, `public/install.sh`, `app/api/cli/logins/route.ts`
- Modify: `lib/oauth.ts` (scope `logins`), `app/oauth/authorize/route.ts` (consent copy when `logins` is requested), `package.json` (`build:cli`, run in `prebuild` so `public/cli/collegeforge.mjs` is built, and gitignored)
- Test: `tests/cli-logins.test.cjs`, `tests/cli.test.cjs`

**Interfaces:**
- Sign-in: OAuth 2.1 + PKCE against Forge's existing server. Register a client dynamically with redirect `http://127.0.0.1:<port>/callback` and request `scope=mcp logins`. Open the browser to `/oauth/authorize` and catch the code on the loopback listener. Save `{ access_token, refresh_token, expires_at, client_id }` to `~/.config/collegeforge/session.json` with mode 600.
- Data: the CLI calls the existing MCP endpoint `POST /mcp` (JSON-RPC `tools/call`) for `list`, `show` and `check`, using the tool names already in `lib/mcp-tools.ts`.
- `GET /api/cli/logins?ids=a,b` with `Authorization: Bearer` → `{ logins: { [appId]: { username, password, portalUrl } } }`. 403 `{ error: "This sign-in can't read saved passwords. Run collegeforge login again." }` unless the grant's scope includes `logins`. `Cache-Control: no-store`. Rate limit: 30/min per grant.
- Commands and help text: same as College Apps `cli/main.ts:19-30`, with `collegeapps` → `collegeforge`. `COLLEGEFORGE_URL` overrides the base URL for local dev.
- Consent copy when `logins` is requested, added to the "It can" list: "Read your saved portal usernames and passwords, for the collegeforge command-line tool on your computer."

- [ ] **Step 1: Failing tests:** `logins endpoint 401 without token`, `403 for an mcp-only grant`, `returns only the asked ids for a logins grant`, `consent page names password access only when logins is requested`, `cli parses list/show/creds/check/1password args like College Apps` (port `cli/args` tests).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the scope, the endpoint, the CLI port, the build script and `install.sh`. `install.sh` downloads `https://forge.xanom.co/cli/collegeforge.mjs` to `~/.local/bin/collegeforge`; port College Apps' script and change only names and URL.
- [ ] **Step 4: Run** `npm test` and `npm run build`. Expected: PASS, and `public/cli/collegeforge.mjs` exists.
- [ ] **Step 5: Manual check** against production after deploy: `curl -fsSL https://forge.xanom.co/install.sh | sh`, then `collegeforge login`, `list`, `show buffalo`, `creds buffalo` (read it yourself; don't paste output anywhere), `logout`.
- [ ] **Step 6: Commit** `feat: collegeforge command-line tool`.

### Task 6: Record College Apps moves

**Files:** Modify `lib/collegeapps-import.ts` (after a successful import write `collegeapps-moved/<sha256(lowercased email)>.json` → `{ at }`). Create `app/api/service/moved/route.ts`: `GET` with bearer `FORGE_SERVICE_KEY` → `{ hashes: string[] }`, the moved hashes plus sha256 of every `accounts/` email. Tests in `tests/applications.test.cjs`: `import records the moved email hash and never the email itself`, `moved endpoint 401 without the service key`, `moved endpoint returns hashes only`.

- [ ] Steps: failing test → run → implement → run → commit `feat: remember which College Apps accounts moved to Forge`.

### Task 7: Retire collegeapps.n3el.dev (only after Task 3 is verified)

**Files (College Apps):** `worker/src/index.ts`, `web/public/install.sh`, `README.md`, `test/retire.test.ts`

**Behavior:**
- `scheduled()`: drop `enqueueDue`; keep `pingForge`. Leave the queue consumer so in-flight messages drain, but have `runCheck` return early without emailing (guard: `env.RETIRED === "1"`, set in `wrangler.jsonc` vars).
- `fetch`: allowlist `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/vault`, `/api/service/*`. Any other `/api/*` → `410 { error: "College Apps is now part of Forge: https://forge.xanom.co" }`. Every non-API path → `301` to `https://forge.xanom.co/hub/index.html#applications`.
- `email()`: Forge inbox only (Task 4). Old D1 addresses are rejected with "This address moved. Set up forwarding again in Forge."
- `install.sh`: prints "collegeapps is now collegeforge" and runs Forge's installer.

- [ ] **Step 1: Failing vitest tests:** `scheduled no longer enqueues checks but still pings Forge`, `GET / redirects to Forge with 301`, `POST /api/auth/login still works`, `GET /api/vault still works`, `POST /api/service/check still works`, `other api paths are 410`, `runCheck sends no email when RETIRED`.
- [ ] **Step 2–4:** run → implement → run.
- [ ] **Step 5:** Update College Apps README (moved notice; what the worker still does). Commit `feat: retire College Apps into Forge; keep only the portal engine`. `gitleaks git .`, `npm run deploy`.
- [ ] **Step 6:** Verify live: `/` 301s, the Forge import still works with a disposable College Apps test account, Forge's next sweep still checks portals, and no College Apps emails go out (Resend dashboard / logs).

### Task 8: One-time notice to College Apps users who haven't moved

**Files (College Apps):** `scripts/notify-moved.ts`

- Reads `users` from D1 with `wrangler d1 execute collegeapps --remote --json`. Excludes emails whose sha256 is in Forge's `collegeapps-moved/` and emails matching any Forge account email: the script reads the Forge Blob list through a small authed Forge endpoint `GET /api/service/moved` that returns hashes only.
- Email (subject "College Apps is now Forge") says: automatic checks and emails moved to Forge on <date>; sign in at forge.xanom.co with a Xanom account and choose "Bring your schools over" with the College Apps email and password; saved logins come along.
- `--dry-run` (default) prints the count and the rendered text. `--send` requires `--count=<n>` to match the computed count.

- [ ] **Step 1:** Implement, run `--dry-run`, and **show the user the count and text. Stop for approval.**
- [ ] **Step 2:** Only after explicit approval, run `--send --count=<n>`. Report sent/failed counts.
- [ ] **Step 3:** Commit `chore: one-time notice to College Apps users`.
