# Forge iOS: shared contract for screen agents

The foundation (Core, DesignSystem, App, SignIn) is done and tested. Build your feature on top of it.
This repo is public: synthetic data only in previews, fixtures and tests. Do not commit or push.

## Build and test

```sh
cd /Users/neel/Documents/GitHub/forge/ios && xcodegen generate && xcodebuild -project Forge.xcodeproj -scheme Forge -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath /tmp/forge-dd-<yourname> CODE_SIGNING_ALLOWED=NO build
```

Use `test` in place of `build` to run the unit tests (Swift Testing, `ForgeTests/`). Sources are folder-based: a new `.swift` file in your folder is picked up after `xcodegen generate`. The build has zero warnings; keep it that way.

Swift 6 strict concurrency. Views are `@MainActor`. Models are `Sendable` value types.

## Ownership rules

| Agent | Folder you own | Root view (keep the name) |
|---|---|---|
| Applications (+ Decisions) | `Forge/Features/Applications/` | `ApplicationsView` |
| Essays | `Forge/Features/Essays/` | `EssaysView` |
| Colleges (Explore, Shortlist, Recommendations) | `Forge/Features/Colleges/` | `CollegesView` |
| Profile (Profile, Progress, Onboarding) | `Forge/Features/Profile/` | `ProfileView` |
| More (Settings, Share/Export, AI chat, notifications, connections, sign out) | `Forge/Features/More/` | `MoreView` |

- Edit only files inside your own folder. Do not edit `Core/`, `DesignSystem/`, `App/`, `Features/SignIn/`, `project.yml` or another agent's folder.
- Need a model field, an endpoint or a helper Core lacks? Add it in a **new file in your folder** as an extension, e.g. `Features/Colleges/APIClient+Colleges.swift` with `extension APIClient { func searchColleges(...) }`. Prefix private types with your area to avoid name clashes (`CollegesSearchResult`, not `SearchResult`).
- Never name a type `Testing`, `Test`, `Tag`... that shadows a framework. (`Tag` and `TestScores` already exist in Core.)
- Your root view replaces the placeholder file in your folder. Keep the `NavigationStack(path: $router.<yourPath>)` (see Router), wrap content in `WorkspaceGate`, apply `.forgeScreenBackground()`.
- Previews: `.previewEnvironment()` injects services seeded with `PreviewData` (synthetic).

## Environment objects

All injected at the root; read them with `@Environment(Type.self)`:

| Type | What |
|---|---|
| `WorkspaceStore` | workspace + tracker data, all reads and writes |
| `Router` | selected tab, per-tab `NavigationPath`, deep links |
| `SessionModel` | `phase`, `user` (name, email), `signOut()` |
| `PushManager` | notification permission state, `requestAuthorization()` |

`AppConfig` is at `store.config` (`baseURL`, `resolve(_:)`, `shareURL(token:)`, `pushEnvironment`). The raw client is `store.api`.

## WorkspaceStore (`Core/Store/WorkspaceStore.swift`, `+Actions.swift`)

```swift
@MainActor @Observable final class WorkspaceStore {
    let api: APIClient
    var config: AppConfig
    var phase: Phase                     // .idle / .loading / .loaded / .failed(APIError) (first load only)
    var isRefreshing: Bool
    var refreshError: APIError?          // last background refresh failure; show an ErrorBanner
    var workspace: Workspace             // always non-nil (.empty before load)
    var tracker: TrackerView
    var applications: [TrackedApplication]
    var hasLoaded: Bool
    func application(id: String) -> TrackedApplication?

    func loadIfNeeded() async            // WorkspaceGate calls this
    func refresh() async                 // pull-to-refresh: .refreshable { await store.refresh() }
    func refreshApplications() async     // tracker only

    // Writes. Throw APIError (show error.message). Optimistic changes roll back on failure.
    func patch(_ patch: WorkspacePatch, optimistic: ((inout Workspace) -> Void)? = nil) async throws
    func postAction(_ action: String, fields: [String: JSONValue] = [:]) async throws -> WorkspaceActionResponse
    func perform(_ action: ApplicationAction, optimistic: ((inout TrackerView) -> Void)? = nil) async throws -> ApplicationsResponse

    // Ready-made optimistic helpers
    func updateApplication(id: String, _ edit: ApplicationEdit) async throws
    func setStatus(_ status: AppStatus, forApplication id: String) async throws
    func removeApplication(id: String) async throws
    func revealDecision(forApplication id: String) async throws
    func setFollowUp(_ followUpID: String, done: Bool, inApplication id: String) async throws
    func resolveFlag(_ flagID: String) async throws
    func saveEssayDraft(id: String, text: String) async throws   // debounce ~1s while typing
    func updateCollege(_ college: College) async throws          // collegePatch by slug
    func setColleges(_ colleges: [College]) async throws         // add/remove/reorder shortlist
    func togglePlannerTask(_ key: String, done: Bool) async throws
}
```

How writes reconcile: optimistic edits show immediately; when no request is in flight the screen snaps to the newest server copy (by `revision`). Overlapping writes don't flicker, failed ones roll back. A `.signedOut` error anywhere sends the app to the sign-in screen by itself; don't handle it.

Examples:

```swift
// Status change with haptic + error alert
@State private var error: APIError?
Button("Mark admitted") {
    Task {
        do { try await store.setStatus(.admitted, forApplication: app.id); Haptics.success() }
        catch { self.error = APIError.wrap(error); Haptics.error() }
    }
}
.errorAlert($error)

// Add a school from the catalog
try await store.perform(.add(collegeId: school.id))

// Custom optimistic workspace patch
try await store.patch(.with { $0.removeScholarshipId = s.id }) { $0.scholarships.removeAll { $0.id == s.id } }

// Share link
let r = try await store.postAction("create-share", fields: ["label": "Parents", "scope": "progress"])
let url = r.token.map { store.config.shareURL(token: $0) }

// Tier untiered shortlist schools ("assess-tiers"): reply adds assessed/unknown school names
let (assessed, unknown) = try await store.shortlistAssessTiers()
```

## Models (`Core/Models/`)

All decode leniently: missing fields get defaults, numbers-as-strings are accepted, a bad array element is skipped, unknown enum values are kept (never crash). All are `Codable, Hashable, Sendable`, with memberwise inits.

**Workspace** (`GET /api/workspace`, lib/store.ts): `revision, draftStorageKey, applicant: Applicant, profile: Profile, ed: EarlyDecision?, criticalDates: [CriticalDate], colleges: [College], essays: EssaySet, essayDrafts: [String: String], plannerDone: [String: Bool], recommendations: [Recommendation], scholarships: [Scholarship], financialAid: FinancialAid, advisorNotes: [AdvisorNote], shares: [ShareMeta], recoveryCode: String?, uploads: [UploadMeta], onboarding: OnboardingState, applicationRead: ApplicationRead?, admissionOdds: [String: AdmissionOdds], schoolStats: [String: JSONValue]`, plus `needsOnboarding: Bool`.

- `Applicant`: name, cycle, year, gpaWeighted, gpaUnweighted, sat, satNote (stats are "—" when unset; use `string.isPresentStat`), awards: Int, gpaByYear: [String: String] ("9".."12"; PATCH merges per year, "—" clears one), gpaTrend: String? and gpaRecent: String? (server-derived from gpaByYear with two or more years; lib/gpa-years.ts).
- `Profile`: intended, hs, gradYear (String), location, counselor, residency, `testing: TestScores {sat, satNote, aps: [APScore{course, score}]}`, `coursework: Coursework {honors, aps, senior: [String]}`, `activities: [Activity{rank, name, type, org?, years?, role?, hpw?, wpy?, college?, desc?, bullets?}]`, `honors: [Honor{title, level, year?, top?}]`.
- `College` (shortlist, `id == slug`): slug, name, short, location?, setting?, rank: Int?, admit?, satRange?, gpa?, photo?, tier: CollegeTier? (.reach/.target/.safety), verdict: Verdict{tone,label}?, priority?, major?, deadline?, supp?, tags: [Tag{label,tone}]?, size?, act?, netPrice?, grad6?, earnings?, plans: [PlanRate{plan,rate}]?, deadlines: [PlanDeadline{plan,date}]?, fee?, transfer?, scorecardId?, coa?, tuitionIn?, tuitionOut?, grad4?, retention?, ownership?, testPolicy?, pellRate?, url?, priceCalcUrl?.
- `EssaySet {commonApp: [Essay], supplements: [String: [Essay]]}` (+ `all`). `Essay {id, group?, label, prompt, limit: Int, unit ("words"/"characters"), starter?}`, `length(of:)`, `countsCharacters`.
- `EarlyDecision {school, deadline, daysLeft, reason}`; `CriticalDate {date, label, detail, source?}`.
- `Recommendation {id, name, type: RecommenderType, subject?, status: RecommendationStatus, deadline?, notes?, askedAt? (yyyy-mm-dd), email? (<=254, validated; "" clears), schools?: [String] (tracker app ids; unknown ids are dropped; nil keeps the server's list), thankYouSent?: Bool, bragSheet? (<=4000)}`. `LetterReceipts` (Letters/LetterReceipts.swift) ports `receiptFor` from public/hub/recommenders.js: per assigned school, received / missing / no portal data from the portal checklist, matched by last name or counted by type; `Scholarship {id, name, amount?, deadline?, status: ScholarshipStatus, url?, notes?, kind?, slug?}`; `FinancialAid {fafsaStatus, cssStatus: AidFormStatus, idocStatus: AidFormStatus (default .notApplicable), fafsaOpenDate?, notes?}` (see Aid below). Each status type has `.all` and `.label`.
- `AdvisorNote {id, body, author, createdAt (ms), essayId?, via?}`; `ShareMeta {token, label, scope?, createdAt, revokedAt?, isActive}`; `UploadMeta`.
- `OnboardingState {completed, completedAt?, storyNotes: StoryNotes?, listPrefs: ListPrefs?}`; `ListPrefs {ambition, appCount: Int?, settings, size, regions, notes}` (allowed values in the doc comment).
- `AdmissionOdds {percent, low, high, baseline, baselineSource, summary, factors: [OddsFactor{label, effect, detail}], sources, estimatedAt}`, keyed by shortlist slug or `"app:<tracked id>"`. `ApplicationRead`.

**Tracker** (`GET /api/applications` → `TrackerView`, lib/tracker-service.ts `viewTracker`): `revision, autocheck, emails, flags: [TrackerFlag{id, text, scope, createdAt}], apps: [TrackedApplication]`.

`TrackedApplication`: `id, collegeId?, slug?, name, logo? (site-relative path), portalName, portalUrl, status: AppStatus, statusLabel, stage: AppStage, round: ApplicationRound, roundFromPortal, deadline ("yyyy-mm-dd" or ""), decisionDate: KeyDate?, nextDate: KeyDate?, decision: DecisionView{state, portalText}, portal: PortalSnapshot?{checkedAt, ok, error, statusText, update, checklist: [PortalItem{item, status, date, done, optional}]}, missing: [String], submittedAt, followUps: [FollowUp{id, text, due, done, createdAt}], lastFailure: PortalFailure?{at, error}, notes, decisionNote, login: PortalLogin?{username, hasPassword}, testingPlan: TestingPlanView?, lastChecked (ms)?, updatedAt, interest: [InterestEvent], interestSignal: InterestSignal?, oddsKey: String? (its key in Workspace.admissionOdds; look up with CollegesOdds.forApp)`.

- `TestingPlanView {policy: TestPolicy{kind ("required"/"optional"/"blind"/"flexible"/"unknown"), selfReport?, superscore?, text, sourceUrl}, recommendation: TestingRecommendation{advice ("send"/"your_call"/"consider_withholding"/"dont_send"/"no_score"/"check_site"), label, reason, sourceUrl}, choice: TestingChoice{plan: TestPlanChoice (.undecided .send .withhold), method: TestMethod? (.selfReport "self_report", .official), officialSent? (yyyy-mm-dd), apSelfReported?}, hasAps, needsScoreSend}` (lib/testing-plan.ts). Only from the student's own tracker; progress share links omit it.
- `InterestEvent {id, kind: InterestKind (.visit .virtualSession .infoSession .fair .interview .aoContact .emailOpened .other; `.all`, `.label`), date, time? ("HH:MM"), who?, notes?, prep?, thankYouSent? (interviews), done, createdAt}`, `.owesThankYou`. `InterestSignal {counts ("important"/"considered"/"not_considered"/"unknown"), interview ("evaluative"/"informational"/"by_invitation"/"not_offered"/"unknown"), countsFact?, interviewFact? (InterestFact{text, sourceUrl}), logged, thankYouOwed, nudge?}`, `.countsLabel`, `.interviewLabel` (lib/interest-log.ts).

- `AppStatus` (`.planning .inProgress .finalChecks .submitted .submittedNpy .complete .deferred .waitlisted .admitted .committed .denied .withdrawn`, `.all`, `.label`, `.stage`, `.isOutcome`; DesignSystem adds `.tone`, `.systemImage`).
- `AppStage` (`.working .waiting .admitted .denied .closed`, `.all`, `.label`, `.tone`).
- `ApplicationRound` (`.none ("") .ed .ed2 .ea .rea .rd .rolling`, `.all`, `.label`, `.short`).
- `DecisionState`: `.none`, `.hidden` (posted, not opened: show "Decision posted" and a reveal action; never show outcome text), `.revealed`, `.recorded`.
- `KeyDate {date, kind ("Deadline"/"Decision"), estimated}`.

**Actions** (`ApplicationAction`, POST /api/applications): `.add(name:collegeId:slug:portalUrl:edit:)`, `.update(id:edit:)`, `.remove(id:)`, `.reveal(id:)`, `.login(id:username:password:)`, `.forgetLogin(id:)`, `.autocheck(on:)`, `.emails(on:)`, `.inbox(on:newAddress:birthdate:)` (on nil = read status), `.check(ids:)` (slow, up to 2 min, rate limited), `.importCollegeApps(email:password:)`, `.followUpAdd(id:text:due:)`, `.followUpSet(id:followUpId:done:remove:)`, `.flagAdd(text:scope:)`, `.flagResolve(flagId:)`, `.interestAdd(id:edit:)` (kind and date required), `.interestSet(id:interestId:edit:)` with `InterestEdit {kind, date, time, who, notes, thankYouSent, done, remove}`. `ApplicationEdit {status, round, deadline, decisionDate, notes, decisionNote, portalUrl (https:// or ""), name, submittedAt, testing: TestingEdit?{plan, method ("self_report"/"official"/"" clears), officialSent (yyyy-mm-dd or "" clears), apSelfReported}, aidOffer: AidOffer?}`; nil = unchanged. Reply: `ApplicationsResponse {data: TrackerView?, app?, checked?, inbox: InboxStatus?, added?, linked?, total?}`.

**WorkspacePatch** (PATCH /api/workspace, lib/workspace-patch.ts). Set only what changes: `listPrefs, applicant: ApplicantPatch, profile: ProfilePatch, ed (EarlyDecision??; .some(nil) clears), criticalDates, colleges, essays: EssaysPatch, essayDrafts, plannerDone, recommendations, scholarships, financialAid, essayDraft {id,text}, plannerToggle {key,done}, recommendation (upsert; id "" creates), removeRecommendationId, scholarship (upsert), removeScholarshipId, removeAdvisorNoteId, collegePatch (pass the full current college with changes)`. Array fields replace the server's array: build them from `store.workspace`. Build inline with `WorkspacePatch.with { $0.x = ... }`.

**Other**: `MeResponse {signedIn, user {email, name}}`, `CatalogSchool {id, name, state, monogram, colors, portalName, loginUrl, howToLogIn, logo?}`, `Connection {id, name, host, createdAt}` (the app's own grant shows as "Forge for iPhone"), `InboxStatus {address?, birthdate}`, `JSONValue` (any JSON; literal-expressible; `decode(_:)`).

**Dates** (`Core/Util/ForgeDates.swift`): `day("yyyy-mm-dd") -> Date?`, `iso(Date)`, `today()`, `short(_)` ("Nov 1" / "Jan 8, 2027"), `daysUntil(_) -> Int?`, `relative(_)` ("tomorrow", "in 5 days"), `ago(milliseconds:)`. `Date(milliseconds:)` for server timestamps.

## APIClient (`Core/Networking/`)

Adds `Authorization: Bearer`, `x-forge-app: ios`; refreshes once on 401 (one shared refresh for concurrent requests); maps failures to `APIError`.

```swift
func get<T: Decodable>(_ path: String, query: [URLQueryItem] = [], as: T.Type = T.self) async throws -> T
func post<T: Decodable>(_ path: String, body: some Encodable, timeout: TimeInterval = 30, as: T.Type = T.self) async throws -> T
func patch<T: Decodable>(_ path: String, body: some Encodable, as: T.Type = T.self) async throws -> T
func decode<T: Decodable>(_ type: T.Type, from: APIRequest) async throws -> T
func send(_ request: APIRequest) async throws -> (Data, HTTPURLResponse)        // raw 2xx body
func stream(_ request: APIRequest) async throws -> (URLSession.AsyncBytes, HTTPURLResponse) // AI chat streaming
// APIRequest("GET", "/api/x", query:, body:, timeout:), or try .json("POST", "/api/x", encodable)
// DataEnvelope<T> unwraps {success, data}. A {success:false, error} reply throws .server(message).

// Typed endpoints
me(), workspace(), patchWorkspace(_:), workspaceAction(_:fields:), applications(), applications(_ action:),
catalog(), connections(), revokeConnection(id:), registerDevice(token:environment:), unregisterDevice(token:),
export(format:) -> (data, filename?)   // "txt" | "brief" | "ics" | "json"
calendarFeed() -> CalendarFeedLink?, calendarFeed("create" | "revoke") -> CalendarFeedLink?
// GET/POST /api/workspace/calendar: {success, data: {https, webcal, createdAt} | null}. "create" replaces any
// old link (it stops working). The feed itself, GET /api/calendar/<token>, needs no sign-in: the token is the credential.
```

Prefer the store for anything it holds. Use `store.api` directly for data the store doesn't keep (catalog, college search, connections, AI chat, exports), from your own extension file.

`APIError`: `.offline`, `.signedOut`, `.server(status:message:)` (server's own words, safe to show), `.rateLimited(message:)`, `.unavailable`, `.decoding`, `.cancelled`. Always show `error.message`; `isRetryable` tells you whether to offer retry. `APIError.wrap(anyError)`.

Logos and photos are site-relative (`/logos/x.png`): `store.config.resolve(path)` or `SchoolLogo(name:path:config:)`.

## Router (`Core/Navigation/Router.swift`)

```swift
enum AppTab { case applications, essays, colleges, profile, more }   // .title, .systemImage
struct ApplicationRoute: Hashable { let id: String }
@MainActor @Observable final class Router {
    var selectedTab: AppTab
    var applicationsPath, essaysPath, collegesPath, profilePath, morePath: NavigationPath
    func openApplication(id: String)     // switch tab + push ApplicationRoute
    func popToRoot(_ tab: AppTab)
    func handle(_ url: URL) -> Bool      // collegeforge://application/<id>, collegeforge://tab/<name>
}
```

Root view pattern (required so deep links and tab re-tap work):

```swift
struct EssaysView: View {
    @Environment(Router.self) private var router
    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.essaysPath) {
            WorkspaceGate { EssaysList() }
                .navigationTitle("Essays")
                .forgeScreenBackground()
                .navigationDestination(for: EssayRoute.self) { EssayEditor(id: $0.id) }
        }
    }
}
```

**Applications agent**: register `.navigationDestination(for: ApplicationRoute.self)` on your stack; push taps and other tabs (e.g. Profile > Progress) open an application with `router.openApplication(id:)`. Decisions live in your tab (e.g. a segmented control or a "Decisions" section/route).

## Push (`Core/Push/`)

Handled by the foundation: permission primer sheet (shown once after the first tracked application), APNs registration, `POST /api/devices` on every launch, `DELETE` on sign-out, tap → `router.openApplication(id:)` + tracker refresh, foreground arrival → banner + tracker refresh. Payload: `{"aps":{...},"type":"portal_update","appId":"<tracked app id>"}`.

**More agent**: `push.authorizationStatus`, `push.isAuthorized`, `push.requestAuthorization()`, `push.lastError`; when `.denied`, link to `UIApplication.openNotificationSettingsURLString`. Keep sign-out (`await session.signOut()`, with a confirmation) and the `#if DEBUG` `DeveloperSection` (server override via `AppConfig.setDebugBaseURL(_:)`, relaunch to apply) from the placeholder.

## Design system (`Forge/DesignSystem/`)

Colors (`Theme.*`, all light/dark): `canvas` (page), `surface`, `card`, `fill`, `hairline`, `ink` (primary text), `body`, `muted`, `mutedSoft`, `accent` (actions; also the app tint), `accentSoft`, `coral` (brand, urgent), `teal`, `amber`, `success`, `danger`. `ToneName.color("good"|"top"|"ok"|"error"|...)` for web tone strings; `AppStatus.tone`, `AppStage.tone`, `CollegeTier.tone`.

Spacing `Theme.Spacing.xxs 4 / xs 8 / sm 12 / md 16 / lg 24 / xl 32`; radius `Theme.Radius.small 6 / medium 10 / large 14`.

Type: system text styles (Dynamic Type). `Font.forgeDisplay(.title2)` = serif (New York) for titles/hero numbers; nav bar titles are already serif. `Font.forgeEyebrow`, `Font.forgeNumber(.title)` (monospaced digits).

Components:

```swift
StatusBadge(status: app.status)
Badge(text: "Reach", tone: CollegeTier.reach.tone, showsDot: true)
SectionHeader(title: "Waiting to hear", detail: "4 schools", actionTitle: "See all") { ... }
Eyebrow(text: "Due this week")
EmptyStateView(systemImage: "tray", title: "No applications yet", message: "…", actionTitle: "Add a school") { ... }
LoadingView(label: "Checking portals…")
ErrorStateView(error: apiError) { await retry() }
ErrorBanner(message: store.refreshError!.message, retry: { ... }, dismiss: { store.refreshError = nil })
.errorAlert($error)                       // Binding<APIError?>
SchoolLogo(name: app.name, path: app.logo, config: store.config, size: 40, tint: nil)
PrimaryButton(title: "Save", systemImage: nil, isLoading: saving) { ... }   // full width
Button("…").buttonStyle(.forgePrimary) / .buttonStyle(.forgeSecondary)
ProgressRing(progress: 0.4, lineWidth: 6, tint: Theme.accent, label: "3/8", size: 56)
Card { ... }  /  view.forgeCard()
ForgeRow(title:, subtitle:) { leading } trailing: { trailing }
LabeledValueRow(label: "Deadline", value: "Jan 4", systemImage: "calendar")
WorkspaceGate { content }                 // first-load spinner / retry
view.forgeScreenBackground()             // canvas behind lists
ForgeMark(size: 44)
Haptics.success() / .warning() / .error() / .selection() / .tap()   // or .sensoryFeedback
```

## Quality bar

Native first: `List` with sections, `NavigationLink`, `.sheet` with detents for add/edit forms, `.swipeActions` (status, done, remove), `.contextMenu`, `.refreshable`, `.searchable`, `Menu`/`Picker` for statuses and rounds, `ShareLink` for share links and exports, `.confirmationDialog` for destructive actions. Every list has empty, loading and error states. Dynamic Type at accessibility sizes must not clip (no fixed heights on text). Check dark mode. Copy: plain and short, the web's wording where it exists. Files under ~400 lines; split views into small structs.

## Testing against a server

- Production: run the app, "Continue with Xanom".
- Local dev server: launch args `-ForgeBaseURL http://localhost:3000 -ForgeDevToken <bearer>` (DEBUG builds). The token skips OAuth. Settings > Developer also stores a server override.
- `xcrun simctl launch <udid> co.xanom.forge -ForgeBaseURL ... -ForgeDevToken ...`

## Server-side expectations (not in this folder)

The app depends on: the proxy accepting `Authorization: Bearer <oauth access token>` + `x-forge-app: ios` as a session for every `/api` route, **and answering 401 (not an anonymous workspace) when that bearer is invalid**; `POST/DELETE /api/devices`; the portal-check cron sending APNs with the payload above; the same device token re-registered by a different account moving to that account.

## Aid (scholarships, aid forms, aid offers)

Validated on the server by `lib/aid-validate.ts`; derived by `lib/aid-plan.ts`. Models in `Core/Models/Aid.swift` and `Planning.swift`.

- **Scholarship** `{id, name, amount?, deadline?, status, url?, notes?, kind?: "outside"|"school", slug?}`. `kind "school"` is the school's own award, tied to `slug` (a college on the list); missing `kind` means outside. A `slug` without a `kind` is saved as `"school"`; `slug: ""` clears the link. Decision detection writes letter awards as `{kind:"school", slug}`; the decision board reads them with `aidOffer`.
- **FinancialAid** gains `idocStatus` (AidFormStatus, default `"n_a"`). FAFSA has no `"n_a"`.
- **TrackedApplication.aidOffer** `AidOffer {costOfAttendance?, grants?, loans?, workStudy?, notes?, updatedAt}`: whole US dollars per year, 0 to 1,000,000. Set with `.update(id:, edit: ApplicationEdit(aidOffer:))`; the server sets `updatedAt` and accepts `"$12,000"` text as well as numbers; `null` (web only) removes it. Private to the student: never in share links, parent or counselor views.
- **Validation** (PATCH /api/workspace answers 400 with a message to show): scholarship `status` in the enum; `name` 1-200 characters; `amount` 60; `notes` 2000; `url` must be http(s) with a host; `deadline` must be `""` or a real yyyy-mm-dd date (an older free-text deadline may be sent back unchanged); `slug` must be on the list (or unchanged); at most 200 scholarships (a new upsert past 200 is refused; edits still work); `fafsaStatus`, `cssStatus`, `idocStatus` in their enums; `fafsaOpenDate` `""` or yyyy-mm-dd.
- **GET /api/aid** (read-only, the caller's own workspace; no share-token access) → `{success, data: AidPlan}`: `{schools: [AidSchool], totals: {cssSchools, idocSchools, scholarshipsWon, wonAmount}}`. `AidSchool {appId, name, slug?, ignoreAid, css: "required"|"not_required"|"unknown", idoc, cssNote, cssSource, cssCheckedAt, meetsFullNeed?, meritAid?, deadlines: [{plan, date, kind: "aid"|"scholarship"}], followUps: [{id, text, due}], todos: [{text, due}]}`. One row per application not denied or withdrawn; `ignoreAid` rows keep their CSS reading but have no deadlines or to-dos. `"unknown"` means "check the school's aid page", never "not required". "Add to-dos" posts `.followUpAdd(id: appId, text:, due:)` for each `todos` entry; the server skips an open follow-up with the same text. `api.aidPlan()` fetches it; `AidBySchoolSection` shows it in Letters & aid.
- **Parents and counselors** (lib/parent-view.ts, standard and full): `financialAid.idocStatus` and `aidBySchool: [{appId, name, ignoreAid, css, idoc, cssSource, deadlines, followUps}]`. Never aid offers, school award amounts (`kind "school"` or any `slug`) or decision letters; full advisor share links (`publicShareView`) drop them too.

## One list for the List, Applications and Essays (feat/list-apps-essays)

- The server keeps `Workspace.colleges` and the tracker's applications in step (lib/list-sync.ts) on every write: an application without a list school gets one (origin "user"), and every kept list school (not an automatic seed suggestion; a starred one counts as kept) gets a Not started application. iOS does no backfill itself.
- Removing a school on either side removes the other only when the application is untouched (`TrackedApplication.untouched`: Not started, no login, notes or follow-ups). Otherwise the other side stays and is unlinked (`offList: true` on the application, or the slug in the workspace's `noApplication`). Essay drafts are never deleted. Say so in the remove confirm.
- So after `perform(.add/.remove/.importCollegeApps)` the store reloads the workspace, and after a `colleges` PATCH it reloads the applications (`WorkspaceStore.refreshWorkspace` / `refreshApplications`).
- New Workspace fields: `essayHidden: [String: Bool]` (essay id → true) and `commonAppPrompt: String?` (a ca-ps-* id). New WorkspacePatch fields: `essayHidden: [String: Bool?]` (true hides, nil is sent as null and shows) and `commonAppPrompt: String??` (`.some(nil)` clears). The server refuses a prompt id outside the Common App choose-one set.
- `EssayCatalog.groups(colleges:essays:hidden:commonAppPrompt:)` filters like the web: hidden essays move to `EssayGroup.hiddenEssays`, and a chosen prompt drops the other ca-ps-* prompts. Hidden essays leave every count.

## Portal ops: check schedule, master login, forwarded set-up details

- `TrackerView.schedule: CheckSchedule? {everyHours (8|12|24), startHour (0-23), timeZone (IANA), times: ["HH:00"], nextAt (ms)?}` (lib/check-schedule.ts `describeSchedule`). Nil from an older server. `CheckScheduleText.hour(_:)` / `.summary(_:)` format it. Automatic checks run once per slot; manual checks never move the schedule.
- `.schedule(everyHours:startHour:timeZone:)` saves it; send `TimeZone.current.identifier`. Saving marks the current slot done, so no check runs straight away.
- `TrackedApplication.login.source`: `"master"` when the school uses the master login (`PortalLogin.isMaster`), nil for its own. `TrackedApplication.setupWaiting`: a forwarded set-up email left details to finish by hand.
- Master login actions: `.masterLogin(username:password:)` (empty username = account email), `.forgetMaster`, `.useMaster(id:on:)` (on replaces the school's own login and pins the portal host; needs a portal link), `.applyMasterAll` (catalog schools without a login; reply `applied`). Their replies carry `master: MasterLoginStatus {on, username, appCount}`; GET /api/applications carries it too (`APIClient.masterLogin()`). The master password is never returned.
- `.setupDetails(id:)` → `setup: SetupDetails {username, password, pin, link, linkChecked, state, reason}`; only for the signed-in student, rate limited. Show it only when the student taps to reveal it. Show `link` only when `linkChecked` is true (the server found it on the school's own host) and it is https.
- `TrackedApplication.portalFromEmail`: the portal link came from a forwarded email and the student hasn't saved a new one. Never open it as a link (`openablePortalURL` is nil); show it in the edit form with a warning. Saving a login, using the master and the CLI's `/api/cli/logins` all refuse or skip such a school until the student saves a changed link. Send `portalUrl` in an edit only when it changed: resending the same link does not clear the mark. Adding a school a forwarded email already created returns that app with `portalFromEmail` true; tell the student.
- Forwarded-email Worker (College Apps) contract for `POST /api/service/inbox`: `op: "lookup"` must send `collegeId` plus every URL it will type a password into (`portalUrl`, `link`); with no URL, or any URL off that catalog school's own hosts, no `usePassword` comes back. The Worker must not type any password after a redirect that leaves those hosts (`college.hosts`, `loginUrl`'s host); it aborts and reports `state: "todo"`. A catalog school's emailed `portalUrl` off its own hosts is replaced by the catalog `loginUrl`. `arrival.reason` is shown to the student and kept in notes as plain text, never as a link.
- `InboxStatus` adds `useMasterForNew` (set with `.inbox(on: true, useMasterForNew:)`) and `recent: [RecentArrival {name, state, reason, receivedAt}]` (last 20, no secrets).

## GPTZero AI check (web only for now)

- `GET /api/gptzero` → `{connected, email?}` (email partly hidden). `POST {action:"connect", email, password}` saves the login only if GPTZero accepts it; `{action:"disconnect"}`. The password never comes back and must not be cached on the device.
- `POST /api/gptzero/scan {essayId}` → `{data: workspace, result: {verdict: "ai"|"mixed"|"human"|"unknown", confidence, ai, mixed, human, message, sentences, flagged: [{sentence, prob}], scanId, version}}`. The server checks the saved draft, so save the draft first. Needs 50+ words. 409 = saved login no longer works, 429 = rate or GPTZero quota.
- `Workspace.essayAiChecks?: {[essayId]: {checkedAt, verdict, ai, mixed, human, words}}`: the latest totals only. Optional; decode leniently.

## Writing coaches (web only for now)

- A writing coach is a follower link with `role: "coach"` on the parent invite flow: `POST /api/parents {action:"invite", role:"coach", email}` (no level; it's always `"essays"`), accepted at `/parent/accept`. Up to 3. `set-level` on a coach is refused.
- `GET /api/parent` rows gain `role` (`"parent"` | `"coach"`); a coach's row has the first name only and no `applications`. `me.parent.coach` is `true` when any followed student made this account their coach.
- `GET /api/parent/[id]` for a coach returns `{level:"essays", role:"coach", student:{name, cycle}, essays, schools:[{slug, name}], essayDrafts, essayStatus, notes:[{id, body, author, createdAt, essayId, mine}]}` and nothing else (no `progress`, so the current `ParentDashboard` decode fails for coaches until the iOS side handles `level == "essays"`). `POST /api/parent/[id] {action:"note", essayId, body}` / `{action:"delete-note", noteId}` are coach-only.
- `AdvisorNote.via` can be `"coach"`, with `byLink` (the coach's link id). Show those as "Coach · <author>".

## Decision letters and awards

Portal checks can capture the decision letter. Its body stays sealed on the server (`letters/<ws>/…`, lib/decision-letters.ts) and never appears in the workspace, share links, parent or counselor views, exports, emails, pushes or widgets.

- `DecisionView.result: AppStatus?` (`admitted`, `denied`, `waitlisted`, `deferred`): only when `state == .revealed`; nil when unclear or from an older server. Prefer it over `DecisionLogic.guess`.
- `TrackedApplication.letter: DecisionLetterMeta?{id, kind: LetterKind (.html .pdf .text), capturedAt (ms), result?, awards: [DecisionAward{name, amount, period}]}`: the revealed decision's letter, nil while hidden or when none was captured. Show the portal link only when it's nil.
- `TrackedApplication.letterHistory: [DecisionLetterMeta]`: letters of earlier decisions the student opened, newest first.
- `.letter(id:letterId:)` returns `ApplicationsResponse.letter: DecisionLetter{id, kind, text, html?, pdfBase64?, capturedAt, result?, awards}` (no `data`). Refused until the decision is revealed. Show HTML only with JavaScript off and no base URL (`DecisionLetterView`). Store wrapper: `store.decisionLetter(forApplication:letterId:)`.
- `.awardAdd(id:index:letterId:)` (action `"award-add"`) adds that award to `scholarships` as `{status: "won", kind: "school", slug?}`; idempotent. Store wrapper: `store.addLetterAward(_:letterId:forApplication:)`.
- `.reveal(id:)` now also records the outcome as the status while the application is still pending (up to Under review, or deferred or waitlisted), so `status`/`statusLabel` read "Admitted" right after a reveal.
- Confetti: `CelebrationBurst` is hosted over the whole list by `DecisionsList` and `ApplicationDetailView`; `DecisionPanel` takes a `celebrate: Binding<Int>` and bumps it for an admit (reveal) or a recorded admitted/committed.
- Widgets read only `decision.state`, `status`/`statusLabel`, `stage` and `decisionDate`; never `result`, `letter` or awards.

## Decision board (`Features/Applications/Decisions/DecisionBoard*.swift`)

- `GET /api/decisions/board` → `DecisionBoardResponse` `{schools, picks, stale, fingerprint, targets}`. Each school: `id, name, logo, standing ("committed"|"admitted"|"waitlisted"|"deferred"), pickable, position, average, rankSummary, careerCovered, pros, cons, switch [{major, level, label}], cost {amount, basis "offer"|"income"|"sticker"|"average", label} | null, costNote, aidOffer, awards [{name, amount}], notes, decisionNote`. Covers admitted and committed schools, then waitlisted and deferred ones; a decision still hidden on Decisions never shows. `picks` is `{picks [{appId, headline, why, watchOut}] (1–2), rows [{label, a, b}] (≤8), summary, fingerprint, madeAt}` or null; `stale` is true when anything the picks read changed since.
- `GET /api/ai/decision-plan` → `{step {label, prompt}, fingerprint}`; 400 with no admit. Run `step.prompt` through `POST /api/ai/chat` with `"mode": "decision"` (via `MoreAIClient.chat(..., mode:)`, so the account's ChatGPT/Grok cookies go along), then reload the board. That mode has `set_decision_picks` as its only tool and a short system prompt with no workspace snapshot; no other mode may call `set_decision_picks`. The prompt stays under 8,000 characters (the chat cap).
- Both refuse with 400 (never creating a workspace) when the visitor has none, and send `cache-control: no-store`.
- Each board school's `aidOffer` is the application's `AidOffer` (see Aid above). The board's cost is `costOfAttendance - grants` when the offer has a cost of attendance, else the estimate. Awards are the won `kind "school"` scholarships tied to the school's slug (letter awards land there). A school counts once its status is admitted/committed/waitlisted/deferred, or, while still pending, once a revealed `decision.result` says so.
- `profile.switchTo` and `profile.pathNote` (≤200 / ≤500 chars, `PATCH /api/workspace` profile) feed the board and its AI picks only; they never change the List tab ranking.
- `workspace.decisionBoard` holds the saved picks. It, and every `aidOffer`, is left out of share links, progress links and the parent views.
- Entry: a "See your offers" row at the top of Decisions when at least one school admitted the student, pushing `ApplicationsDestination.decisionBoard`. No fifth segment.

## Essay schools (feat/essay-schools)

- Every school on the list is an "essay school" (its supplements show on Essays) until the student turns it off. `Workspace.essaySchools: [String: Bool]` holds only the turned-off schools, keyed by Essays group key (a college slug, or `"uc-application"` for every UC campus together), always `false`. Missing means writing.
- PATCH /api/workspace `essaySchools: {key: false | null}`: false turns a school off, null turns it back on. `true` is refused (400), as are the key `"common"` (the Common App is always written), a bad key and more than 500 keys. `WorkspacePatch.essaySchools: [String: Bool?]` (nil is sent as null). Nothing else changes: the school stays on the list and keeps its prompts and drafts.
- `EssayCatalog.groups(..., essaySchools:)` drops turned-off schools' groups (orphan groups stay), and `EssayCatalog.schools(colleges:essaySchools:)` gives one row per group for the "Pick essay schools" sheet (UC campuses share one row). Turned-off schools leave every count. `EssayCatalog.groupKey(for:)` maps a list school to its key.
- Agents: `list_essays` and `get_essay` mark a turned-off school's essays `hidden: true, not_writing: true`; `set_essay_visibility` takes `not_writing_for` and `writing_for` (school keys). Parents and counselors never get a turned-off school's supplements or drafts.

## Essay choices (ios/parity-essays)

- `Essay` now carries the prompt fields the web reads: `required: Bool?`, `chooseGroup: String?`, `choose: Int?`, `options: [String]?` (nil when empty) and `audience: String?` (nil when empty), all decoded leniently and sent back unchanged when a prompt is edited (the server's essay schema accepts them; `source` and `cycle` are stripped on write, so the app ignores them).
- `Workspace.essayOption: [String: Int]`: which option (0-based) of a choose-one prompt the student answers, by essay id. PATCH `essayOption: {id: index | null}` (`WorkspacePatch.essayOption: [String: Int?]`, nil is sent as null and clears it). A picked option that states its own total limit ("(150 word limit)") is the limit shown and counted (`EssayChoiceRules.withChosenOption`); prompt edits save the stored limit, not the option's.
- Choose-N sets (UC: 4 of 8) and per-college prompts (Cornell, Tufts, an honors-college opt-in) are chosen with `essayHidden` patches built by `EssayChoiceRules.pickPatch` and `audiencePatch`, as on the web.
- Schools whose every required essay is final (or, with only optional essays, every shown one) get a checkmark and sort after open schools (`EssayWritingProgress.finishedGroups`, `sidebarOrder`). Expanded schools are remembered on the device per workspace (`EssayExpansionMemory`).

## Maia scattergrams (`Features/Colleges/Scattergrams/`)

- `GET /api/workspace/scattergrams` → `{success, data: ScattergramDoc | null}` (lib/scattergrams.ts): `{version: 1, importedAt (ms), classOfYears, student: {gpa, wgpa, sat} | null, colleges: {[slug]: {slug, name, rank?, n, counts: {Accepted|Denied|Waitlisted|Deferred|Other: n}, averages: {gpa, sat}, points: [{sat, gpa, result, round}]}}}`. SAT only (no ACT); either number on a point can be null, and only points with both are plotted. `DELETE` clears it all.
- Importing is web-only (a bookmark run in Maia on a computer, public/maia/import.js); the app only views and deletes. Entry: a "Scattergrams" row on Shortlist, pushing `ScattergramsRoute`.
- Each point is a real past applicant from the student's school: keep the doc in the screen's memory only. Never log, cache, export or put it in widgets. The AI reads it server-side (lib/scattergram-summary.ts); nothing to send from the app.
- The student's marker follows the web page: Maia's numbers where present, else `applicant.gpaUnweighted` / `applicant.sat` (`ScattergramLogic.studentMarker`).
