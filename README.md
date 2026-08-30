# College Forge — free AI college planning hub

A hub anyone can use to plan college applications. An AI copilot (your own **Grok**
or **ChatGPT** account via OAuth) reads uploads — transcripts, resumes, award
lists, college lists — and **populates every page**: profile, school list, essays,
planner, timeline, recommendations, scholarships, and financial-aid checklist.

**Not** a Common App login integration. Export paste-ready packs and share a
read-only advisor link instead (safe and ToS-friendly).

## Quick start

```bash
npm install
npm run build
npm start          # http://localhost:3000  → /hub/index.html
# or: npm run dev
```

Open the app, complete onboarding, connect **Grok or ChatGPT** in the copilot.
Upload a file or describe your profile — the hub fills in.

## What’s included

| Area | Features |
| --- | --- |
| **Profile** | GPA, testing, coursework, activities (CA limits: 10 × 150 chars), honors (max 5), manual edit |
| **Explore** | College Scorecard search + full school detail, US News top 250 + photos |
| **Shortlist** | Reach/target/safety tiers + application status pipeline |
| **Essays** | 2026–27 Common App prompts (650-word PS, 300-word additional info) + supplements; drafts on server |
| **Planner / Timeline** | Tasks + deadlines (planner checks persist) |
| **Track** | LORs, scholarships, FAFSA / CSS checklist + official links |
| **Compare** | Side-by-side school metrics |
| **Share** | Recovery code (multi-device), advisor read-only links + notes, exports (txt / brief / ics / json) |

## How the AI populates the site

1. **Connect** — OAuth for Grok or ChatGPT; tokens in httpOnly cookies.
2. **Upload** — `POST /api/upload` extracts PDF/DOCX/text into the workspace.
3. **Chat** — tools write structured data (`lib/hub-tools.ts`).
4. **Edit** — Profile / Shortlist / Track also write via `PATCH /api/workspace`.
5. **Share** — recovery codes + `/hub/share.html?t=…` advisor views.

## Storage

| Environment | Driver |
| --- | --- |
| Local | `data/workspaces/`, `data/shares/`, `data/recovery/` (or `CF_DATA_DIR`) |
| Vercel | Private **Vercel Blob** (`BLOB_READ_WRITE_TOKEN`) |

Always read workspace blobs with `useCache: false`.

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
node scripts/verify.mjs
BASE=https://forge.n3el.dev node scripts/verify.mjs
```
