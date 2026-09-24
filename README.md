# College Forge — free AI college planning hub

A college planning workspace with a guided setup, evidence-backed school recommendations, manual profile and essay editors, deadlines, and application tracking. An optional AI copilot (your own **Grok** or **ChatGPT** account via OAuth) can interpret uploads and update your plan.

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
| **Profile** | Labeled editors for academics, AP scores, coursework, activities (10 × 150 chars), and honors (max 5) |
| **Colleges for you** | Fair-ranking evidence, intended-major outcomes, region/setting filters, provisional categories, source dates, AI discussion |
| **Explore** | College Scorecard search + full school detail, US News top 250 + photos |
| **Shortlist** | Reach/target/likely or unassessed categories, application status, confirmed removal |
| **Essays** | 2026–27 Common App prompts (650-word PS, 300-word additional info) + supplements; drafts on server |
| **Planner / Timeline** | Persistent checklist, manually editable milestones, dated school deadlines |
| **Track** | LORs, scholarships, FAFSA / CSS checklist + official links |
| **Compare** | Side-by-side school metrics |
| **Share** | Recovery code (multi-device), advisor read-only links + notes, exports (txt / brief / ics / json) |

## How the AI populates the site

1. **Connect** — OAuth for Grok or ChatGPT; tokens in httpOnly cookies.
2. **Upload** — `POST /api/upload` extracts PDF/DOCX/text into the workspace.
3. **Chat** — tools write structured data (`lib/hub-tools.ts`).
4. **Edit** — Profile / Shortlist / Track also write via `PATCH /api/workspace`.
5. **Share** — recovery codes + `/hub/share.html?t=…` advisor views.

The copilot uses `get_college_recommendations`, the same evidence engine as the recommendations screen. Rankings are a starting point, not a claim that a college is best for every student. The interface distinguishes missing evidence from provisional admission categories and historical average net price from a personal aid offer.

## Recommendation evidence

`lib/college-recommendations.ts` joins the published fair-ranking snapshot (`public/data/rankings/top250.json`) to stored admissions records by federal institution ID and published major outcomes where available. Within provisional academic categories, selection weights the career-outcomes score (75%) and where the intended major ranks among colleges with published earnings (up to 25 points), using `public/data/rankings/majors/bachelors_by_school.json`. The ranking itself scores outcomes only; see `ranking/METHODOLOGY.md`. Region and setting preferences filter the pool; unsupported constraints are disclosed. Missing evidence stays unknown, UC comparisons ignore SAT, and weighted GPA is never converted to a guessed unweighted GPA.

Coverage is limited to the published 250-college snapshot. Sources, dates, methodology, and limitations are shown in the product. AI explanations require a connected provider; deterministic recommendations do not.

## Storage

| Environment | Driver |
| --- | --- |
| Local | `data/workspaces/`, `data/shares/`, `data/recovery/` (or `CF_DATA_DIR`) |
| Vercel | Private **Vercel Blob** (`BLOB_READ_WRITE_TOKEN`) |

Always read workspace blobs with `useCache: false`. Workspace mutations use `updateWorkspace(id, mutate)`: Blob writes compare strong ETags and retry against current data; local writes use an exclusive filesystem lock and atomic replacement. Mutation callbacks must be replayable and must not perform external side effects. The client ignores responses older than the current workspace revision. Pending essay edits also have a local browser recovery journal, isolated by a non-secret `draftStorageKey`, until server saving succeeds. Keep your recovery code to reopen the server workspace on another device.

## Frontend development

The hub JSX remains in `public/hub/`. `npm run dev` compiles it and watches for edits; `npm run build` compiles it before Next.js builds. Production React and compiled scripts are served locally from the ignored `public/hub/compiled/` directory. The hub loads React as script globals, and React 19 ships no UMD builds, so the hub stays on React 18.3.1 from `vendor/react-18.3.1/` while the Next.js pages use React 19. `npm run build:hub` regenerates only these assets. Runtime Babel and external JavaScript CDNs are not required.

## Environment

See `.env.example`. Optional:

- `OPENCODE_API_KEY` — fallback if no Grok/ChatGPT connected
- Web search key for live admit/deadline research
- `BLOB_READ_WRITE_TOKEN` — required on Vercel (from Blob store)

## Deploy

Live: **https://forge.n3el.dev**

```bash
vercel deploy --prod
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
BASE=https://forge.n3el.dev node scripts/verify.mjs
```

Browser checks use the installed Google Chrome and default to `http://127.0.0.1:3210`. Start the app on that port first. Component regression scripts under `scripts/test-*.mjs` also cover editing, failed saves, draft recovery, and mobile comparisons. Live AI replies require a connected account and are a separate integration check.

For local storage only, a process killed during a write can leave a `.json.lock` file. Stop/verify all writers before removing a confirmed abandoned lock; the application deliberately never steals locks from a paused or slow writer. This does not apply to the Blob driver.

## License

Code is [MIT](LICENSE). College photos, U.S. News rankings and essay prompts belong to their respective owners; College Scorecard data is public domain.
