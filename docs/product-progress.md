# Product improvement progress — 2026-09-22

The active goal remains the full usable college-planning product, including comfortable UI and useful AI recommendations grounded in the fair-ranking dataset. This work is a substantial implementation pass, not a completion claim.

## Implemented

- Grouped responsive workspace navigation, keyboard access, real browser history, useful home-page next steps and progress.
- Final populated-screen audit: 11 screens at 320/390/768/1440 pixels passed overflow/control-label checks, with screenshots inspected. Mobile essay picker brings the editor into view; profile/shortlist summaries are compact; copilot no longer blocks page navigation and restores visible focus. Full evidence and limits: `docs/ui-audit.md`.
- Planner task completion now uses stable semantic IDs; ambiguous legacy row-number checks are retained and require review. School status handling and UC-neutral labels are consistent.
- Profile academic validation matches setup; invalid GPA/SAT/year inputs cannot be saved by the editor.
- Provider choice is explicit (Auto retains fallback). Refresh outages preserve sign-ins, connection failures are retryable, incomplete streams restore prompts, duplicate Enter is guarded, and workspace changes clear conversation state.
- Grounded recommendation endpoint and screen using the published 250-college outcomes snapshot, major evidence, region/setting filters, editable preferences, source dates, and honest unknown/provisional categories.
- AI recommendation tool and grounded context; the same engine seeds onboarding. AI sign-in is optional for setup.
- Labeled activity, honor, coursework, and AP editors; shortlist status/removal; manual essay prompts and milestones; visible persistence errors.
- Essay saves serialized across page changes, with a workspace-isolated local recovery journal for failed saves and reloads.
- Read failures and malformed workspace files cannot initialize over existing data.
- All mutations use replayable `updateWorkspace`: cross-process locks + atomic file replacement locally; uncached strong-ETag conditional writes with bounded conflict retry on Blob. Process-local queues reduce contention without replacing distributed version checks.
- Real Blob-backed preview stress test: 27 simultaneous synthetic saves all returned 200 and survived, with unique revisions. Initial test reproduced 20 successful responses retaining only one edit; the fixed test preserves every edit. Real compressed JSON exposed weak ETags, resolved by identity-encoding reads. Generic conditional-operation conflicts are narrowly retried.
- Monotonic revisions and explicit workspace-switch guards stop delayed responses restoring old state. AI tools capture the initial draft namespace and reject stale workspace reads/writes after reset.
- Reset invalidates previous advisor links and recovery codes; advisor notes cannot resurrect revoked links. Recovery no longer exposes the bearer workspace ID in JSON.
- Export waits for pending drafts, supports selecting a Common App essay, preserves deliberate blank drafts, validates/folds calendar data, and reports skipped dates. Advisor view now shows drafts and timeline; recovery requires confirmation and a successful draft flush.
- Responsive college search and populated school comparisons, with confirmed removal and failed-lookup retry.
- Local production React assets and build-time JSX compilation; the hub and share page load with all external requests blocked. Development rebuild watcher included.

## Verification

- `npm test`: 57 recommendation, storage, AI-tool/provider, export, and route regressions plus compiled-asset checks.
- `npm run build`: production compilation and TypeScript.
- Component browser checks: profile, shortlist, tracker, planning, draft recovery, and onboarding.
- Live browser checks: no-AI setup with persisted recommendations after reload; preferences and saved schools; mobile navigation; search/add/remove/compare; all pages with external requests blocked.
- `scripts/verify.mjs`: server, assets, upload, and provider-unavailable behavior.

Re-run the commands when continuing; files and runtime are authoritative. Local production preview uses port 3210. Stop it before rebuilding `.next`, then restart. No deployment or commit has been performed.

## Still open against the original goal

1. **Live connected AI verification.** Fresh local browser has no ChatGPT/Grok connection and no fallback key. The user was asked asynchronously to connect their preferred account. The data/tool integration is tested, but a real provider reply and tool-writing round trip remain unverified.
2. **Live sharing validation.** Automatic approval review rejected a browser test that would create recovery/share credentials, expose a workspace to another context, and post advisor notes. The equivalent UI uses intercepted synthetic fixtures, and real route handlers are tested against isolated temporary storage. Do not retry the rejected live mutation without new authorization.
3. **Final product audit.** Populated-screen layout/control-label checks and focused keyboard/failure flows are verified; see `docs/ui-audit.md`. This is not a claim of full WCAG compliance. Connected authentication/provider round trips remain unverified. Do not treat mocked AI responses as a real account test.
4. **Deployment.** Production is live at forge.n3el.dev; college-forge.vercel.app redirects to it. Preview storage, Scorecard, Exa, and TinyFish variable scopes were confirmed without decrypting values.

Known data limits are disclosed in the app: the recommendation pool is a dated 250-college snapshot; major outcomes cover published top-25 tables; admissions data is aggregate and cannot establish program/residency-specific odds; average net price is not a personal offer. Free-text constraints and size require further research.

## Operational notes

- `.env.local` contains a Blob configuration: the localhost preview is backed by that service unless explicitly overridden. The tested synthetic workspaces never contained real student data. Avoid unnecessary live mutations; sharing tests must remain synthetic pending authorization.
- For a connected AI test, use the browser session where the user signs in, not a fresh headless cookie jar. The user asked what the pending question was; they were told to connect either ChatGPT or Grok in local Settings. No provider choice or completed sign-in has been received yet.
- Local filesystem locks are never stolen automatically. A killed writer can leave a lock; verify all writers are stopped before operator cleanup. Blob uses version checks and has no filesystem lock.

## Current handoff

Authorized implementation and independent verification are complete for this pass. The original goal is not achieved: a real connected AI recommendation/tool round trip is still required. The same account-connection blocker has persisted across three goal turns; the user was asked, then asked what the question was, and has not provided a provider choice or completed sign-in. The accessible browser Settings explicitly showed both accounts disconnected. A one-shot Aside REPL tab is temporary, so do not assume that tab remains open; use the clickable local Settings URL for handoff.

Production build and 57 Node regressions pass. Browser checks cover planner identity, profile validation, failed AI/status streams, mobile writing, copilot navigation, workspace switching, and the existing end-to-end flows. The isolated fixture server on 3211 is stopped; the production preview on 3210 remains running. Changes have not been committed or deployed. Do not continue inventing independent changes merely to avoid this verified external blocker.

## Deployment handoff — 2026-09-22

- Preview: https://college-forge-jm08qb3f8-infocus-news-projects.vercel.app
- Build details: https://vercel.com/infocus-news-projects/college-forge/DXM1caA6tAvWTSybrZhEThfCr5m8
- Vercel reported READY. Remote prebuild compiled hub.js and share.js; Next production compilation and type checks passed. 57 local regressions passed immediately before deployment.
- Fixed `.vercelignore` so `scripts/build-hub.mjs` ships while local workspace data, environment files, other scripts, and regenerated compiled assets do not.
- No runtime requests were made to the deployed URL, following the deployment skill. Live connected AI verification is still pending. Production domain unchanged.

## Production promotion — 2026-09-22

User explicitly requested promotion. Vercel CLI rebuilt the verified preview for production as deployment `dpl_7dyH78tT9Ft1bYjDhitzMat3pJR8`. Vercel API confirms `READY`, `target: production`, no alias error, and aliases `forge.n3el.dev`, `college-forge.vercel.app`, and `college-forge-infocus-news-projects.vercel.app`.

Live URL: https://forge.n3el.dev
Build details: https://vercel.com/infocus-news-projects/college-forge/7dyH78tT9Ft1bYjDhitzMat3pJR8

This supersedes earlier local-only/preview-only deployment notes. Connected AI verification remains pending; promotion itself is complete.
