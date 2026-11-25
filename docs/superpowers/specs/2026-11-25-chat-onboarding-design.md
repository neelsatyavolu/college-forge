# Chat onboarding: AI interview, researched college list

Date: 2026-11-25. Status: design, awaiting approval.

## Why

Today onboarding is an 8-step form (`public/hub/Onboarding.jsx`). The college list comes from a fixed formula (`lib/college-recommendations.ts`), and the AI is optional and arrives at the end. Its research is shallow: `lib/build-plan.ts` gives each school one web search, two schools per request. Students should instead be interviewed by their own AI. The AI should learn who they are, the way a good counselor would, and then produce a list that is the right size, balanced in difficulty and ambition, and backed by real, current research: deadlines, prompts, aid and a timeline.

## Goals

- The AI is required. Onboarding starts by connecting ChatGPT (Codex) or Grok. OpenCode, which runs on a server key, stays available when configured.
- Onboarding is a chat interview in fixed sections, in this order:
  1. basics
  2. school and grades, including a transcript upload
  3. testing
  4. activities and honors
  5. campus preferences
  6. money: budget, need-based aid, merit interest
  7. early plans: ED/EA
  8. deep questions: what drives them, what they want to study and why, what they want from college, a story worth telling
- Questions with fixed answers render as clean tiles in the chat. The student can always type instead.
- The AI proposes a draft list as school tiles. The student approves, drops, swaps or asks for more.
- The AI then deep-researches the approved list while the student watches, school by school, with sources.
- The AI recommends an ED/EA strategy with reasons, and the student confirms it.
- A student can leave mid-interview and resume where they left off.
- Target length is 15–25 minutes, including about 5–8 deep questions with follow-ups.

## Non-goals

- A form fallback for students without an AI. It was explicitly rejected.
- The audited research files for the US News top 100 national universities and top 50 liberal arts colleges. They are a separate, later project. This design only leaves a hook for them (see "Research sources").
- Changing how the rest of Forge reads the profile. The interview writes the same fields the form wrote.
- iOS app changes.

## Anti-goals (a failure even if it works)

- A form wearing a chat costume: fixed wording, no follow-ups.
- An interview that finishes with fields missing that the list needs, such as GPA, residency, budget or aid need.
- Research facts with no source or date, or old-cycle data presented as current.
- A list with no affordable likely school.
- Tile markup that renders as garbage text when a model gets a format wrong. This is why tiles come from tool calls, not text.

## Decisions made with the user

| Topic | Decision |
|---|---|
| AI required | Yes. There is no form fallback. Free, unlimited AI does not exist at the needed volume (100–300 calls per student). |
| How tiles appear | **Approach A.** The AI calls an `ask_question` tool, and the client renders tiles from it. |
| Interview control | A required checklist enforced by the server. The AI chooses wording, follow-ups and deep questions. |
| Length | 15–25 minutes |
| Resume | Yes, at the point where the student left |
| Where candidates come from | The existing formula seeds a balanced set. The AI researches fit, cuts weak picks, and may add any US school with a stated reason. |
| Balance | Keep today's reach/target/likely ratios by ambition (`college-recommendations.ts:170-178`). Require at least 2 affordable likely schools. The AI picks the total count, 8–15, and the student can change it at approval. |
| Who decides the list | The AI proposes and the student approves before deep research |
| ED strategy | The AI recommends one with reasons, and the student confirms |
| After the interview | **Wait and watch.** Research runs in the chat with live per-school progress. |
| Scraping | A private Cloudflare Worker that speaks Firecrawl's `/v2/scrape` and `/v2/search` API. It reads pages with Cloudflare Browser Rendering (markdown output) and gets search results from Exa. |
| Research files | Built after this ships |
| Where research facts live | Saved on each school as new research fields with sources, and shown in the school's detail in Shortlist. Deadlines and prompts keep flowing to Timeline and Essays as they do now. |
| Redo for existing students | The draft starts from the student's current schools. The AI suggests adds and drops as tiles, and nothing is removed without a tap. Essays and tracker rows stay attached. The hub stays usable during a redo. |

## Approaches considered

- **A. Question tool (chosen).** The AI calls `ask_question({kind, prompt, options…})`. The server streams a new `question` event, and the client draws tiles. The student's answer comes back as the next user turn. This works the same across Codex, Grok and OpenCode, because all three already call tools reliably.
- **B. Markup in the reply text.** The AI writes a fenced block, and the client parses it. Rejected because models break the format and the student then sees raw text.
- **C. A Forge script with AI wording.** A state machine picks every question. Rejected because it is the "form in a chat costume" anti-goal.

## Design

### 1. Flow

```
Connect AI ──► Interview (sections 1–8, checklist-gated)
           ──► Draft list (school tiles: approve / drop / swap / more)
           ──► Deep research, watched live (per-school cards with sources)
           ──► ED/EA recommendation (tiles to confirm)
           ──► Rounds + milestones (existing plan steps)
           ──► Workspace (Shortlist)
```

The **connect** step reuses `ConnectStep` (`Onboarding.jsx:229`). The student cannot go further until `resolveProviderStatus().active` is non-null. A failed sign-in shows retry and help, never a form.

### 2. Interview state (server)

Add `onboarding.interview` to the workspace document (`lib/store.ts`):

- `section`: the current section id
- `transcript`: the stored chat messages, for resume, capped at a sensible size
- `asked`: question ids already answered
- `notes`: short AI-written summaries per section. These keep context small, because the chat route only keeps 24 turns of 8,000 chars each (`app/api/ai/chat/route.ts:13-14`) and a 25-minute interview runs longer than that.
- `deep`: answers to the deep questions. These are also copied into `storyNotes` so the Essays tab can use them.
- `listDraft`, `researchProgress`, `phase` (`interview | list | research | ed | done`)

A checklist module (new, e.g. `lib/interview-checklist.ts`) defines the required fields per section and computes what's missing from the workspace itself. Fields count as filled because the profile has them, not because a question was asked. Minimum required fields:

- name, grad year, high school, intended major (or "undecided"), state of residence
- unweighted GPA, or a transcript the AI has read
- testing: SAT, ACT or "test-optional"
- at least 1 activity, or an explicit "none yet"
- setting/size/region (or "any")
- budget bucket, need-based aid yes/no
- ED stance
- at least 3 deep answers

The interview cannot move to the list phase until the checklist is complete.

### 3. New and changed tools

New tools, in a new file such as `lib/interview-tools.ts`, registered in the chat route only while onboarding is active:

- `ask_question({ id, kind, prompt, options?, min?, max?, allowOther? })`
  - `kind` is one of `single | multi | upload | number | school_search | confirm`.
  - **Ends the AI's turn:** the provider loop stops after this call, so the student answers before the AI continues.
  - Streams a `question` event.
- `interview_status()`: returns the current section, missing checklist fields and the deep-question count.
- `save_section_note({ section, note })`
- `save_deep_answer({ prompt, answer })`
- `advance_section({ to })`: refused while the current section's required fields are missing.
- `propose_list({ schools: [{ name, tier, reason, estChance?, netPrice? }] })`: streams a `list` event. Tiles let the student approve, drop or swap a school, or ask for more. The student's edits come back as a structured user turn.
- `recommend_strategy({ ed?, ea[], reasons })`: streams a `strategy` event with confirm tiles.

Profile writes use the existing tools: `set_testing`, `set_coursework`, `upsert_activity`, `upsert_honor`, `set_profile_identity`, `set_list_preferences`, `read_upload`. Extend `set_list_preferences`, or add a tool, to cover merit interest if needed.

**Codex sends every optional field filled in (0 or "").** All new tool argument parsing must treat 0 and "" as absent.

Add to `ChatEvent` (`lib/chat-types.ts`):

- `{ type: "question"; question: … }`
- `{ type: "list"; schools: … }`
- `{ type: "strategy"; … }`
- `{ type: "research"; school; stage; facts?; sources? }`

### 4. Chat UI

A new onboarding chat view. It may reuse pieces of `AiChat.jsx`, such as the NDJSON reader at `:407-425`. It renders:

- **Tiles** for `single` and `multi`: large tap targets, keyboard accessible, with a "type my own" option when `allowOther` is set.
- **An upload tile** that posts to the existing `/api/upload`, shows the file name and a "read" state, and then tells the AI the upload id.
- **A number input** with the expected range for GPA and scores, and a **school search** backed by the existing college catalog.
- **School tiles** for the draft list, grouped by reach/target/likely, each with its reason, chance and net price.
- **Research progress cards:** one per school, filling in deadlines, prompts and aid as they're verified, each with a source link.
- A section progress bar showing the 8 sections.

Visual style: match `public/hub/workspace.css`. The project has no DESIGN.md. Check 1440px, 1000px and phone widths for odd empty space.

### 5. Deep research, watched live

This is driven from the client in steps, the way `runPlanSteps` works today (`Onboarding.jsx:1224`), because each request allows only 6–10 tool rounds.

- **One school per step**, not two, so each school gets a real search budget.
- Per school, the AI must verify and save:
  - each round's current-cycle deadlines
  - supplemental prompts
  - test policy
  - whether it meets full need, merit aid, and whether CSS Profile is required
  - net price for the student's budget bracket
  - current admit rate and middle-50% scores
  - whether the major is offered and whether it's capped or competitive
  - interview and demonstrated-interest policy
- **Storage:** facts are saved through a new tool, `set_school_research({ college, facts: [{ key, value, sourceUrl, checkedAt, cycle: "current"|"last", thirdParty }] })`, into a new optional `research` field on `College` (`lib/store.ts`). Missing on old workspaces means "not researched". The school detail in Shortlist shows the facts with source links, last-cycle labels and third-party flags.
- **Timing (builder note, my call):** the 15–25 minute target covers the interview only. Research runs as client-driven steps, like `runPlanSteps`, with up to 3 schools in parallel, each school its own step chain. Progress is saved per school, so if the tab closes, reopening onboarding resumes research at the first unfinished school. There is no server-side job.
- **Every saved fact carries a source URL and a checked date.** Official `.edu` pages come first. A third-party source is flagged in the UI. Data from an old cycle is saved as "last cycle" and never shown as current.
- A step that ends without finishing a school, because it hit the round limit, is continued by a follow-up step for the same school. Cap it at 3 continuations, then mark the school "needs review".
- After all schools: the ED/EA recommendation, then the existing rounds and milestones steps.

The research prompt tells the agent to search widely: several queries, the official admissions, aid and supplement pages, and the Common Data Set where it helps. It also tells the agent to cross-check figures, not stop at the first result.

### 6. Research sources

`web_search` and `web_fetch` (`lib/web-search-tool.ts`) stay the AI's tools.

**New private scraper:** a Cloudflare Worker, in its own folder such as `workers/scraper/` or a separate repo (builder's choice).

- It implements `POST /v2/scrape`: render the URL with Browser Rendering and return markdown.
- It implements `POST /v2/search`: use Exa for results, then optionally scrape the top N.
- Forge points `FIRECRAWL_API_URL`/`FIRECRAWL_API_KEY` at it, so `lib/firecrawl.ts` works unchanged.
- It requires a bearer token and rejects non-http(s), localhost, private and metadata addresses.
- It caches page results for a short time (KV or the Cache API) so repeat schools are cheap.

Hook for the later research files: the research step checks for a curated per-school file first (path TBD in that project) and only searches the web for gaps or stale facts.

### 7. Existing pieces

- `complete-onboarding` (`app/api/workspace/route.ts:180`) is still the final write. `seedRecommendedColleges` provides the formula seed that the AI starts the draft list from.
- The old form steps are removed from the UI once the chat ships. Their validation logic is reused by the checklist.
- **Seeding changes (my call):** the seed now runs when the list is drafted, not at the end. `complete-onboarding` only marks onboarding done and saves preferences. It no longer reseeds or overwrites the approved list.
- Existing students keep their data. Settings → redo onboarding starts the chat interview with their current profile, so the checklist starts mostly filled. The draft list is their current schools plus the AI's suggested adds and drops. The hub is not locked during a redo, because `onboarding.completed` stays true until the redo finishes.
- **Build order (my call):** the scraper Worker is its own first phase, but the onboarding doesn't wait for it. Until it's deployed, `web_fetch` falls back to TinyFish as it does today.
- The MCP `complete_onboarding` tool (`lib/mcp-tools.ts:557`) is unchanged.

## Constraints

- This repo is public. No real student data in tests or fixtures. Run `gitleaks` before pushing.
- Interview answers, including family finances, go to the student's own AI provider. Say so in one line on the connect screen.
- The 8,000-char per-message cap: large material such as transcripts goes behind tools (`read_upload`), never into a prompt.
- Next.js in this repo differs from common versions. Read `node_modules/next/dist/docs/` before route changes.

## Left to the builder

- Where the interview state lives exactly, and the transcript cap
- The tile component structure and styling details
- Exact tool schemas
- Whether the provider loops get an "end turn" mechanism or the route ends after `ask_question`
- Where the Worker lives
- The KV vs Cache API choice
- The wording of the system prompts. They must cover the 8 sections, the checklist rule, deep-question guidance and the research standards above.
