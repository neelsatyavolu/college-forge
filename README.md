# College Forge — free AI college planning hub

A college applications workspace: every application's status, round, deadline and decision date in one list, with automatic portal checks, plus evidence-backed school recommendations, essays and letters. Sign-in is a Xanom account. Assistants such as Grok, ChatGPT and Claude can read and edit applications through Forge's MCP server, and an optional AI copilot (your own **Grok** or **ChatGPT** account via OAuth) can interpret uploads and update your plan.

**Not** a Common App login integration. Export paste-ready packs and share a
read-only advisor link instead (safe and ToS-friendly).

## Quick start

```bash
npm install
npm run build
npm start          # http://localhost:3000 (landing page; the hub is /hub/index.html)
# or: npm run dev
```

Open the app and choose **Set up my workspace**, or explore colleges first. AI sign-in is optional. Setup creates a preliminary list from the published outcomes dataset; connect **Grok or ChatGPT** when you want help interpreting it or structuring uploads.

## What’s included

| Area | Features |
| --- | --- |
| **Applications** | Every school's status, round, deadline and decision date; automatic portal checks; missing documents; import from College Apps |
| **Decisions** | Posted decisions stay covered until opened; record the outcome |
| **Essays** | 2026–27 Common App prompts (650-word PS, 300-word additional info) + supplements; drafts on server |
| **Letters & aid** | LORs, scholarships, FAFSA / CSS checklist + official links |
| **Colleges for you** | Fair-ranking evidence, intended-major outcomes, region/setting filters, provisional categories, source dates, AI discussion |
| **Explore / Shortlist** | College Scorecard search + full school detail, US News top 250 + photos; reach/target/likely shortlist with "Track application" |
| **Profile** | Labeled editors for academics, AP scores, coursework, activities (10 × 150 chars), and honors (max 5) |
| **Share & export** | Advisor read-only links + notes, exports (txt / brief / ics / json) |
| **Assistants** | MCP server at `/mcp` with OAuth sign-in for Grok, ChatGPT, Claude and others |
| **Rankings** | Public `/rankings` page for the fair ranking: overall, by major, and beats expectations |

## How the AI populates the site

1. **Connect** — OAuth for Grok or ChatGPT; tokens in httpOnly cookies.
2. **Upload** — `POST /api/upload` extracts PDF/DOCX/text into the workspace.
3. **Chat** — tools write structured data (`lib/hub-tools.ts`).
4. **Edit** — Profile / Shortlist / Track also write via `PATCH /api/workspace`.
5. **Share** — `/hub/share.html?t=…` advisor views.

The copilot uses `get_college_recommendations`, the same evidence engine as the recommendations screen. Rankings are a starting point, not a claim that a college is best for every student. The interface distinguishes missing evidence from provisional admission categories and historical average net price from a personal aid offer.

## Recommendation evidence

`lib/college-recommendations.ts` joins the published fair-ranking snapshot (`public/data/rankings/top250.json`) to stored admissions records by federal institution ID and published major outcomes where available. Within provisional academic categories, selection weights the career-outcomes score (75%) and where the intended major ranks among colleges with published earnings (up to 25 points), using `public/data/rankings/majors/bachelors_by_school.json`. The ranking itself scores outcomes only; see `ranking/METHODOLOGY.md`. Region and setting preferences filter the pool; unsupported constraints are disclosed. Missing evidence stays unknown, UC comparisons ignore SAT, and weighted GPA is never converted to a guessed unweighted GPA.

Coverage is limited to the published 250-college snapshot. Sources, dates, methodology, and limitations are shown in the product. AI explanations require a connected provider; deterministic recommendations do not.

## Storage

| Environment | Driver |
| --- | --- |
| Local | `data/workspaces/`, `data/shares/`, `data/recovery/` (or `CF_DATA_DIR`) |
| Vercel | Private **Vercel Blob** (`BLOB_READ_WRITE_TOKEN`) |

Always read workspace blobs with `useCache: false`. Workspace mutations use `updateWorkspace(id, mutate)`: Blob writes compare strong ETags and retry against current data; local writes use an exclusive filesystem lock and atomic replacement. Mutation callbacks must be replayable and must not perform external side effects. The client ignores responses older than the current workspace revision. Pending essay edits also have a local browser recovery journal, isolated by a non-secret `draftStorageKey`, until server saving succeeds. Signing in with Xanom reopens the server workspace on any device.

## Frontend development

The hub JSX remains in `public/hub/`. `npm run dev` compiles it and watches for edits; `npm run build` compiles it before Next.js builds. Production React and compiled scripts are served locally from the ignored `public/hub/compiled/` directory. The hub loads React as script globals, and React 19 ships no UMD builds, so the hub stays on React 18.3.1 from `vendor/react-18.3.1/` while the Next.js pages use React 19. `npm run build:hub` regenerates only these assets. Runtime Babel and external JavaScript CDNs are not required.

## Applications, accounts and MCP

- **Applications tab** (`public/hub/Applications.jsx`, `lib/tracker.ts`, `lib/tracker-service.ts`): statuses, rounds, deadlines, decision dates (exact or estimated from last cycle) and the last portal check, for any of the 330 schools in `lib/catalog/` or any school by name. The tracker came from College Apps (collegeapps.n3el.dev); `POST /api/applications` `{action: "import-collegeapps"}` copies a College Apps account in by deriving its keys from the password the student types once.
- **Decisions tab**: a decision a portal posts stays covered until the student opens it. Share links, the copilot and MCP never show an unopened decision.
- **Portal checks** (`lib/portal-check.ts`): Forge calls the College Apps Worker's service-only `POST /api/service/check` with one saved login at a time. Logins are encrypted with `PORTAL_LOGINS_KEY` in `logins/<workspace>.json`, outside the workspace document. The College Apps Worker's hourly cron calls `POST /api/cron/portal-checks`, which re-checks portals older than 12 hours.
- **Accounts** (`lib/session.ts`, `app/api/xanom/*`): "Continue with Xanom" (OIDC). Each Xanom `sub` owns one workspace; a first sign-in keeps the browser's existing anonymous workspace. `forge.n3el.dev` redirects to `forge.xanom.co` (`proxy.ts`) and carries that workspace over with a one-time link. Signing in moves the anonymous workspace to a new id that only the account can open.
- **MCP** (`app/mcp/route.ts`, `lib/mcp-tools.ts`): Streamable HTTP at `/mcp`, stateless JSON responses. Forge is its own OAuth 2.1 server (`lib/oauth.ts`): protected-resource and authorization-server metadata under `/.well-known/`, dynamic client registration at `/oauth/register`, PKCE S256 only, one-hour access tokens and rotating 90-day refresh tokens. People approve on `/oauth/authorize` and disconnect in Settings.

## Environment

See `.env.example`. Required in production: `BLOB_READ_WRITE_TOKEN`, `XANOM_CLIENT_ID`, `XANOM_CLIENT_SECRET`, `SESSION_SECRET`, `FORGE_ORIGIN`, `PORTAL_LOGINS_KEY`, `FORGE_SERVICE_KEY`, `CRON_SECRET`. Optional:

- `OPENCODE_API_KEY` — fallback if no Grok/ChatGPT connected
- `EXA_API_KEY` and/or `TINYFISH_API_KEY` — web search for live admit/deadline research
- `COLLEGE_SCORECARD_API_KEY` — College Scorecard API key (light use often works without one)
- `CF_DATA_DIR` — move the local data store

For local development, run with `BLOB_READ_WRITE_TOKEN=` (empty) so a pulled `.env.local` can't point local runs at production storage.

## Privacy

The site, hub and share pages load a page-view script from `analytics.n3el.dev`, a stats service run by the developer.

## Deploy

Live: **https://forge.xanom.co** (forge.n3el.dev redirects there).

Pushes to `main` deploy to production through Vercel's Git integration. To pull the environment variables (blank `BLOB_READ_WRITE_TOKEN` before running locally):

```bash
vercel env pull .env.local
```

## Verify

```bash
npm test
npm run typecheck
node scripts/verify.mjs
node scripts/verify-hub-ui.mjs
node scripts/test-recommendations-live.mjs
node scripts/test-onboarding-live.mjs
node scripts/test-hub-offline.mjs
BASE=https://forge.xanom.co node scripts/verify.mjs
```

Browser checks use the installed Google Chrome and default to `http://127.0.0.1:3210`. Start the app on that port first. Component regression scripts under `scripts/test-*.mjs` also cover editing, failed saves, draft recovery, and mobile comparisons. Live AI replies require a connected account and are a separate integration check.

For local storage only, a process killed during a write can leave a `.json.lock` file. Stop/verify all writers before removing a confirmed abandoned lock; the application deliberately never steals locks from a paused or slow writer. This does not apply to the Blob driver.

## License

Code is [MIT](LICENSE). College photos, U.S. News rankings and essay prompts belong to their respective owners; College Scorecard data is public domain.
