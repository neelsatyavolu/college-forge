# Chat Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 8-step onboarding form with a required-AI chat interview that renders tiles via tool calls, drafts a balanced list, deep-researches each school live with sourced facts, and recommends an ED/EA strategy. Also add a private Cloudflare scraper and seed audited research files for the US News top 100 national and top 50 liberal arts colleges.

**Architecture:**
- A private Cloudflare Worker speaks Firecrawl's `/v2/scrape` and `/v2/search` API, so `lib/firecrawl.ts` is unchanged.
- New interview tools (`ask_question`, `propose_list`, `recommend_strategy`, …) end the AI's turn and stream new NDJSON events that the new chat UI renders as tiles.
- A server-side checklist gates progress.
- Research runs as client-driven steps, one school per step, and writes `College.research` facts with sources.

**Tech Stack:** Next.js 16.4 (read `node_modules/next/dist/docs/` before route changes), React 19 in `public/hub/*.jsx` (compiled by `scripts/build-hub.mjs`), `node:test` .cjs tests that transpile TS, Cloudflare Workers with the Browser Rendering binding and `@cloudflare/puppeteer`, Exa search.

**Spec:** `docs/superpowers/specs/2026-11-25-chat-onboarding-design.md`

## Global Constraints

- The repo is public. No secrets, no real student data, no `.env*`. Run `gitleaks git .` before pushing.
- Optional tool args: treat `0` and `""` as absent, because Codex fills every field.
- Chat messages are capped at 8,000 chars (`app/api/ai/chat/route.ts:14`). Large material goes behind tools.
- Every research fact has `sourceUrl`, `checkedAt` (yyyy-mm-dd), `cycle` (`"2026-27"` for current, or the older cycle), and `thirdParty: boolean`.
- Balance: reuse the ambition ratios in `lib/college-recommendations.ts:170-178`, with at least 2 affordable likely schools and 8–15 applications (all UCs count as 1).
- Visual: match `public/hub/workspace.css`. Check 1440, 1000 and 390px widths for odd empty space.

## Review Focus

1. **The student types instead of tapping a tile.** The answer must still be accepted, saved, and the checklist advanced. Test: interview-tools accept a free-text answer turn.
2. **The AI calls `advance_section` with required fields missing.** It must be refused with the missing list. Test in Task 3.
3. **The tab closes mid-research.** On reopen, research resumes at the first school without `research.complete`. Test in Task 5 (`researchQueue`).
4. **Redo with existing schools, essays and tracker.** The draft list must include every current school, and nothing is removed without an explicit drop. Test in Task 6.
5. **The scraper gets a private or metadata URL, a PDF, or a 404.** It must return a clean error with no browser launch for blocked hosts. Test in Task 1.

---

### Task 1: Private scraper Worker

**Files:**
- Create: `workers/scraper/{wrangler.jsonc,package.json,tsconfig.json,src/index.ts,src/url.ts,src/markdown.ts,test/url.test.ts}`
- Modify: `docs/firecrawl-self-host.md` (add a "Cloudflare Worker" section), `.vercelignore` and `tsconfig.json` exclude `workers/`

**Interfaces:**
- Produces:
  - `POST /v2/scrape {url, formats:["markdown"]}` → `{success, data:{markdown, metadata:{title,url}}}`
  - `POST /v2/search {query, limit}` → `{success, data:{web:[{url,title,description}]}}`
  - Auth is `Authorization: Bearer <SCRAPER_TOKEN>`. Without it, the response is 401.
  - CLI: `node scripts/research/scrape.mjs <url>` and `node scripts/research/search.mjs "<query>"` print markdown or JSON. They read `FIRECRAWL_API_URL`/`FIRECRAWL_API_KEY` from `.env.local`.

- [ ] Test `isAllowedUrl`: false for `http://localhost`, `http://169.254.169.254/`, `http://10.0.0.1`, `file:///x` and `https://user:pw@a.com`; true for `https://admissions.yale.edu/x`.
- [ ] Implement `src/url.ts` and `src/index.ts`:
  - Scrape: plain `fetch` first. For a `text/html` response with at least 1,500 chars of extracted text, convert with `src/markdown.ts` (HTMLRewriter-based: headings, lists, links, tables, script/style stripped). Otherwise fall back to the `BROWSER` binding and convert the rendered HTML with the same function. PDFs return `{success:false,error:"pdf"}`.
  - Cache by URL in a KV namespace `PAGES` for 3 days.
  - Search: Exa `POST https://api.exa.ai/search` with secret `EXA_API_KEY`.
- [ ] Deploy with `wrangler deploy` (account 5eac7df5…). Set the secrets `SCRAPER_TOKEN` (random) and `EXA_API_KEY` (from Vercel prod env) with `wrangler secret put` through stdin; never echo them.
- [ ] Verify: `scripts/research/scrape.mjs https://admissions.yale.edu/` prints markdown, and `search.mjs "Yale early action deadline"` prints results.
- [ ] Set `FIRECRAWL_API_URL`/`FIRECRAWL_API_KEY` in `.env.local` and Vercel production. Commit `feat: private Cloudflare scraper speaking the Firecrawl API`.

### Task 2: Research files for the top 100 national and top 50 LAC schools (background)

**Files:**
- Create: `lib/school-research/<slug>.json` per school, `lib/school-research/README.md`, `lib/school-research.ts`, `tests/school-research.test.cjs`

**Interfaces:**
- Produces:
  - `type ResearchFact = { key: ResearchKey; value: string; sourceUrl: string; checkedAt: string; cycle: string; thirdParty: boolean }`
  - `type SchoolResearch = { slug; name; checkedAt; complete: boolean; facts: ResearchFact[]; deadlines: {plan, date}[]; supplements: {label, prompt, limit?, unit?}[] }`
  - `ResearchKey` = `"admit_rate"|"sat_mid50"|"act_mid50"|"test_policy"|"meets_full_need"|"css_profile"|"merit_aid"|"net_price_lt30k"|"net_price_30_75k"|"net_price_75_110k"|"net_price_gt110k"|"major_notes"|"interview"|"demonstrated_interest"|"ed_ea_options"|"notes"`
  - `loadSchoolResearch(slug): SchoolResearch | null`
- The school list is `public/data/official-rankings.json` `lists.usn` (first 100) plus `lists.lac` (first 50). Slugs come from the existing `lib/colleges.ts` slugger.
- This runs in background research agents in batches. Each uses the Task 1 CLIs, prefers official `.edu` pages, and records every fact with its source.
- [ ] Test: every file validates (required keys, ISO dates, https sources, `cycle` set), and no file contains an email or phone pattern.
- [ ] Implement `lib/school-research.ts` (validator plus loader).
- [ ] Merge the agent batches, run an audit pass (a second agent spot-checks 3 facts per school against the source), then commit `data: audited research for top 100 national + top 50 LACs`.

### Task 3: Interview state and checklist

**Files:**
- Modify: `lib/store.ts` (types plus normalize defaults)
- Create: `lib/interview-checklist.ts`, `tests/interview-checklist.test.cjs`

**Interfaces:**
- Produces:
  - `type InterviewSection = "basics"|"school"|"testing"|"activities"|"campus"|"money"|"early"|"deep"`
  - `SECTIONS: InterviewSection[]` in that order
  - `type InterviewPhase = "interview"|"list"|"research"|"strategy"|"plan"|"done"`
  - `onboarding.interview?: { phase; section; transcript: {role, content, ui?}[] (cap 120 entries); notes: Partial<Record<InterviewSection,string>>; deep: {prompt, answer}[]; listDraftDone?: boolean; startedAt: number }`
  - `College.research?: SchoolResearch` (the Task 2 shape)
  - `missingFields(ws: Workspace, section: InterviewSection): string[]` and `firstIncomplete(ws): InterviewSection | null`
- Required per section:
  - basics: name, gradYear, highSchool, intendedMajor (may be "Undecided"), residency state
  - school: unweighted GPA, or a read upload (`ws.uploads` non-empty and `coursework` set)
  - testing: SAT, ACT, or `testOptional`
  - activities: at least 1 activity, or `listPrefs.notes` containing the `no-activities` marker
  - campus: settings, size and regions set (`"any"` allowed)
  - money: budget, `needAid` boolean
  - early: `ed`
  - deep: `interview.deep.length >= 3`
- [ ] Tests: an empty workspace → `firstIncomplete === "basics"`; a fully filled fixture → `null`; Codex-style `0`/`""` values count as missing.
- [ ] Implement, then run `npm test`. Commit.

### Task 4: Interview tools, end-turn, and stream events

**Files:**
- Create: `lib/interview-tools.ts`, `tests/interview-tools.test.cjs`
- Modify: `lib/chat-types.ts`, `lib/codex-client.ts`, `lib/grok-client.ts`, `lib/opencode-client.ts`, `lib/providers.ts`, `app/api/ai/chat/route.ts`

**Interfaces:**
- Consumes: Task 3 checklist, existing `makeHubTools`
- Produces:
  - `ChatEvent` additions:
    - `{type:"question"; question: UiQuestion}`
    - `{type:"list"; schools: UiSchool[]}`
    - `{type:"strategy"; strategy: UiStrategy}`
    - `{type:"research"; slug; name; stage:"searching"|"reading"|"saved"|"done"|"needs_review"; facts?: ResearchFact[]}`
  - `UiQuestion = {id; kind:"single"|"multi"|"upload"|"number"|"school_search"|"confirm"; prompt; options?: {value,label,hint?}[]; min?; max?; allowOther?}`
  - `UiSchool = {slug?; name; tier:"reach"|"target"|"likely"; reason; estChance?; netPrice?; current?: boolean}`
  - `UiStrategy = {ed?: string; ea: string[]; reasons: string}`
  - `makeInterviewTools(workspaceId, emit): { tools: ToolSpec[]; execute: ToolExecutor; endTurn: () => boolean }`
  - Tools: `ask_question`, `interview_status`, `save_section_note`, `save_deep_answer`, `advance_section`, `propose_list`, `recommend_strategy`, `set_school_research`
  - Provider clients accept `params.shouldEndTurn?: () => boolean`, checked after each round of tool execution. When true they return `finishReason: "awaiting_student"`.
  - Chat route: body `mode: "onboarding"` adds the interview tools and an interview system prompt (`lib/interview-prompt.ts`, built from workspace state: section, missing fields, notes, deep count). It appends `{role, content, ui}` to `interview.transcript`.
- [ ] Tests:
  - `ask_question` emits a question event and sets `endTurn()` true.
  - `advance_section` with missing fields returns an error string listing them and does not change the section.
  - `propose_list` rejects lists outside 8–15 applications, or with fewer than 2 likely schools that fit the student's budget, and the error says why.
  - `set_school_research` drops facts without an https `sourceUrl` and treats `0`/`""` as absent.
  - A free-text answer (no tile) is stored in the transcript like a tile answer.
- [ ] Implement, then run `npm test` and `npm run typecheck`. Commit.

### Task 5: Live research steps

**Files:**
- Create: `lib/research-plan.ts`, `tests/research-plan.test.cjs`, `app/api/ai/research-plan/route.ts`

**Interfaces:**
- Consumes: Task 2 `loadSchoolResearch`, Task 4 `set_school_research`
- Produces:
  - `researchQueue(ws): {slug, name, attempt}[]`: schools without `research.complete`, in list order. `attempt` counts saved continuations (max 3, after which the school is marked `needs_review`).
  - `researchPrompt(college, curated: SchoolResearch | null, ws): string`: tells the AI to start from curated facts and re-verify only stale or missing ones; otherwise search official pages, several queries, and cross-check. It saves via `set_school_research`, `set_application_rounds` and `set_essays`.
  - `GET /api/ai/research-plan` → `{ steps: {slug, label, prompt}[] }`
- [ ] Tests: queue order; school skipped when complete; `attempt` 3 → `needs_review`; curated facts appear in the prompt and the prompt stays under 8,000 chars.
- [ ] Implement, run the tests, commit.

### Task 6: Draft list and onboarding completion

**Files:**
- Modify: `app/api/workspace/route.ts` (`complete-onboarding` stops reseeding; new action `draft-list`), `lib/college-recommendations.ts` (export `draftCandidates(ws, prefs)`)
- Test: `tests/onboarding-setup.test.cjs`

**Interfaces:**
- Produces:
  - `draftCandidates(ws, prefs): UiSchool[]`, using the formula seed for new students. With existing schools, all current schools come first, marked `current:true`, followed by suggested additions.
  - `POST /api/workspace {action:"apply-list", keep: string[], add: UiSchool[]}`: adds new schools, removes only those the student explicitly dropped, and keeps essays and tracker rows for kept ones.
- [ ] Tests: redo keeps every current school in the draft; `complete-onboarding` leaves `colleges` unchanged; apply-list with a dropped school removes only that one.
- [ ] Implement, run the tests, commit.

### Task 7: Onboarding chat UI

**Files:**
- Create: `public/hub/OnboardingChat.jsx`, `public/hub/onboarding-chat.css`, `public/hub/ChatTiles.jsx`
- Modify: `public/hub/App.jsx:222` (render `OnboardingChat`), `public/hub/index.html`, `scripts/build-hub.mjs` (if components are listed), `public/hub/Settings.jsx` (redo label)
- Test: `scripts/test-onboarding-flow.mjs` (update to drive the chat with a stubbed provider)

**Interfaces:**
- Consumes: the Task 4 events, Task 5 route, Task 6 actions, existing `ConnectStep` from `Onboarding.jsx` (export it on `window`)
- Behavior:
  1. Connect gate.
  2. Chat with section progress (8 dots).
  3. Tiles: single (tap sends), multi (select, then Continue), upload (drop zone → `/api/upload`, then sends "Uploaded <name> (id …)"), number (range-validated), school_search (catalog autocomplete), confirm. A text box is always available.
  4. List view: tiles grouped reach/target/likely, each with drop/keep and "more like this", then Approve → `apply-list` → research.
  5. Research view: one card per school, filled from `research` events and the saved facts, run 3 at a time.
  6. Strategy confirm.
  7. Existing `runPlanSteps` rounds and milestones.
  8. Done → Shortlist.
  - Resume: on mount, load `onboarding.interview` and re-render the transcript, including the last unanswered `ui`.
- [ ] Update `test-onboarding-flow.mjs` to cover connect gate → tile answer → upload → list approve → research card → done, using a stub provider.
- [ ] Implement. Run `npm run build:hub` and the flow test. Screenshot at 1440, 1000 and 390 and fix empty space. Commit.

### Task 8: Research facts in Shortlist

**Files:**
- Modify: `public/hub/Shortlist.jsx` (school detail section "Research"), `public/hub/workspace.css`

- [ ] Show facts grouped by Admissions, Testing, Aid, Major and Process. Each fact links to its source and shows its checked date. "Last cycle" and "third-party" appear as small labels. `needs_review` schools show a notice.
- [ ] `npm run build:hub` plus a screenshot check. Commit.

### Task 9: End-to-end with a real AI

- [ ] Using `scripts/test-onboarding-live.mjs` with a synthetic student, run the full flow once with Codex and once with Grok, then fix what breaks.
- [ ] `npm test`, `npm run typecheck`, `gitleaks git .`. Update `docs/product-progress.md`. Commit.
