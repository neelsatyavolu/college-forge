import SwiftUI

/// One school: photo, admissions numbers, rankings, Forge's notes, cost and outcomes, plans, essays,
/// programs and earnings by field.
/// Shows the tapped row at once and fills in the full College Scorecard record when it arrives.
struct CollegeDetailView: View {
    let college: College

    @Environment(WorkspaceStore.self) private var store
    @Environment(CollegesFavorites.self) private var favorites
    @State private var detail: CollegesDetail?
    @State private var isLoading = false
    @State private var loadError: APIError?
    @State private var error: APIError?
    @State private var isBusy = false
    @State private var confirmRemove = false

    /// The row, overlaid with the full record, then with what the student or copilot saved.
    private var shown: College {
        var merged = detail.map { CollegesShortlist.merge(college, with: $0.college) } ?? college
        if let saved = store.shortlistCollege(matching: college) {
            merged.tier = saved.tier ?? merged.tier
            merged.verdict = saved.verdict ?? merged.verdict
            merged.plans = saved.plans?.isEmpty == false ? saved.plans : merged.plans
            merged.deadlines = saved.deadlines?.isEmpty == false ? saved.deadlines : merged.deadlines
            merged.transfer = saved.transfer ?? merged.transfer
            merged.priority = saved.priority
        }
        return merged
    }

    private var isSaved: Bool { store.shortlistContains(college) }

    var body: some View {
        let d = shown
        let extras = detail?.extras
        let research = extras?.research
        List {
            CollegeDetailHero(college: d, config: store.config, extras: extras)
            if let loadError {
                ErrorBanner(message: loadError.message, retry: { Task { await load() } }, dismiss: { self.loadError = nil })
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                    .listRowBackground(Color.clear)
            }
            CollegeAdmissionsSection(college: d)
            CollegeRankingsSection(rankings: extras?.rankings ?? [:], rank: d.rank, lacRank: extras?.lacRank)
            CollegeGlanceSection(college: d, extras: extras)
            CollegeNotesSection(research: research)
            CollegeSpecialNotesSection(intlAid: extras?.intlAid, nursing: extras?.nursing)
            CollegeCostSection(college: d, isLoading: isLoading)
            CollegeIncomeSection(research: research, earningsRange: extras?.earningsRange)
            CollegePlansSection(college: d, researchDeadlines: research?.deadlines ?? [])
            CollegeEssaysSection(essays: research?.essays ?? [])
            CollegeCampusLifeSection(niche: extras?.niche)
            CollegeProgramsSection(programs: detail?.programs ?? [], isLoading: isLoading && detail == nil, isUnavailable: detail?.partial == true)
            CollegeEarningsSection(programs: detail?.programs ?? [], isLoading: isLoading && detail == nil)
            CollegeTransferSection(college: d, switching: extras?.switching ?? [])
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .forgeScreenBackground()
        .navigationTitle(d.short.isEmpty ? d.name : d.short)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar(d) }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            CollegeDetailActionBar(college: d, isBusy: isBusy, add: { Task { await add(d) } })
        }
        .task { if detail == nil { await load() } }
        .refreshable { await load() }
        .confirmationDialog("Remove \(d.name) from your shortlist?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove school", role: .destructive) { Task { await remove(d) } }
            Button("Keep school", role: .cancel) {}
        } message: {
            Text("Saved essay drafts will remain.")
        }
        .errorAlert($error)
    }

    @ToolbarContentBuilder
    private func toolbar(_ d: College) -> some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            let isFavorite = favorites.contains(college.slug)
            Button {
                favorites.toggle(college.slug)
                Haptics.selection()
            } label: {
                Label(isFavorite ? "Unfavorite" : "Favorite", systemImage: isFavorite ? "star.fill" : "star")
            }
            .tint(isFavorite ? Theme.amber : Theme.accent)
            Menu {
                if let url = d.url.flatMap(URL.init(string:)) {
                    Link(destination: url) { Label("College website", systemImage: "safari") }
                    ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up") }
                }
                if let calc = d.priceCalcUrl.flatMap(URL.init(string:)) {
                    Link(destination: calc) { Label("Net price calculator", systemImage: "dollarsign.circle") }
                }
                if isSaved {
                    Divider()
                    Button(role: .destructive) { confirmRemove = true } label: {
                        Label("Remove from shortlist", systemImage: "minus.circle")
                    }
                }
            } label: {
                Label("More", systemImage: "ellipsis.circle")
            }
        }
    }

    private func load() async {
        guard let id = college.scorecardId ?? store.shortlistCollege(matching: college)?.scorecardId else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            detail = try await store.api.collegeDetail(scorecardId: id)
            loadError = nil
        } catch {
            let apiError = APIError.wrap(error)
            if apiError != .cancelled { loadError = apiError }
        }
    }

    private func add(_ d: College) async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await store.shortlistAdd(d)
            Haptics.success()
        } catch {
            self.error = APIError.wrap(error)
            Haptics.error()
        }
    }

    private func remove(_ d: College) async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await store.shortlistRemove(slug: store.shortlistCollege(matching: d)?.slug ?? d.slug)
            Haptics.success()
        } catch {
            self.error = APIError.wrap(error)
            Haptics.error()
        }
    }
}

/// Add to shortlist, or the tier and application controls once it's saved.
private struct CollegeDetailActionBar: View {
    let college: College
    let isBusy: Bool
    let add: () -> Void

    @Environment(WorkspaceStore.self) private var store
    @Environment(Router.self) private var router
    @State private var error: APIError?
    @State private var isTracking = false

    var body: some View {
        Group {
            if let saved = store.shortlistCollege(matching: college) {
                HStack(spacing: Theme.Spacing.sm) {
                    CollegesTierMenu(current: saved.tier, choose: { tier in Task { await setTier(tier, saved) } }) {
                        Label(saved.tier?.isPlanning == true ? saved.tier!.displayLabel : "Set tier", systemImage: "flag")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.forgeSecondary)
                    trackButton(saved)
                }
            } else {
                PrimaryButton(title: "Add to shortlist", systemImage: "plus", isLoading: isBusy, action: add)
            }
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.sm)
        .background(.bar)
        .errorAlert($error)
    }

    @ViewBuilder private func trackButton(_ saved: College) -> some View {
        if let app = store.shortlistTrackedApplication(for: saved) {
            Button { router.openApplication(id: app.id) } label: {
                Text("Applying · \(app.statusLabel)").lineLimit(1).frame(maxWidth: .infinity)
            }
            .buttonStyle(.forgeSecondary)
        } else {
            Button { Task { await track(saved) } } label: {
                Group {
                    if isTracking { ProgressView().tint(Theme.canvas) } else { Text("Track application").lineLimit(1) }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.forgePrimary)
            .disabled(isTracking)
        }
    }

    private func setTier(_ tier: CollegeTier, _ saved: College) async {
        do {
            try await store.shortlistSetTier(tier, for: saved)
            Haptics.selection()
        } catch {
            self.error = APIError.wrap(error)
        }
    }

    private func track(_ saved: College) async {
        isTracking = true
        defer { isTracking = false }
        do {
            try await store.shortlistTrack(saved)
            Haptics.success()
        } catch {
            self.error = APIError.wrap(error)
            Haptics.error()
        }
    }
}
