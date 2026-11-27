import SwiftUI

/// The student's shortlist grouped into reaches, targets and likely schools, with chance estimates.
struct ShortlistView: View {
    @Binding var segment: CollegesSegment

    @Environment(WorkspaceStore.self) private var store
    @Environment(CollegesChancesModel.self) private var chances
    @State private var filter: CollegesTierFilter = .all
    @State private var pendingRemoval: College?
    @State private var error: APIError?

    private var colleges: [College] { store.workspace.colleges }

    var body: some View {
        Group {
            if colleges.isEmpty {
                EmptyStateView(
                    systemImage: "list.star",
                    title: "No schools yet",
                    message: "Add schools from For you or Explore, or ask the copilot to add them.",
                    actionTitle: "Explore colleges"
                ) { segment = .explore }
            } else {
                list
            }
        }
        .toolbar {
            if !colleges.isEmpty {
                ToolbarItem(placement: .topBarTrailing) { EditButton() }
                ToolbarItem(placement: .topBarTrailing) { filterMenu }
            }
        }
        .confirmationDialog(
            "Remove \(pendingRemoval?.name ?? "this school") from your list?",
            isPresented: Binding(get: { pendingRemoval != nil }, set: { if !$0 { pendingRemoval = nil } }),
            titleVisibility: .visible,
            presenting: pendingRemoval
        ) { college in
            Button("Remove school", role: .destructive) { Task { await remove(college) } }
            Button("Keep school", role: .cancel) {}
        } message: { college in
            Text(CollegesShortlist.removalMessage(for: store.shortlistTrackedApplication(for: college)))
        }
        .errorAlert($error)
        .task(id: "\(store.workspace.draftStorageKey)/\(store.workspace.revision)") {
            if !colleges.isEmpty { await chances.loadMetadata(store: store) }
        }
    }

    private var list: some View {
        let sections = CollegesShortlist.sections(colleges, filter: filter)
        return List {
            if let refreshError = store.refreshError {
                ErrorBanner(message: refreshError.message, retry: { Task { await store.refresh() } }, dismiss: { store.refreshError = nil })
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                    .listRowBackground(Color.clear)
            }
            Section {
                ShortlistStats(colleges: colleges)
            } footer: {
                Text(disclaimer)
            }
            Section {
                NavigationLink(value: ScattergramsRoute()) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Scattergrams").font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                        Text("Where past applicants from your high school landed, from Maia Learning")
                            .font(.caption)
                            .foregroundStyle(Theme.muted)
                    }
                }
            }
            ShortlistBalanceSection()
            ShortlistChancesSection()
            ForEach(sections) { section in
                Section {
                    ForEach(section.colleges) { college in
                        NavigationLink(value: CollegesDetailRoute(college: college)) {
                            ShortlistRow(college: college, odds: store.workspace.admissionOdds[college.slug])
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) { pendingRemoval = college } label: { Label("Remove", systemImage: "trash") }
                        }
                        .swipeActions(edge: .leading) {
                            trackAction(college)
                            EssaySchoolButton(college: college) { self.error = $0 }.tint(Theme.muted)
                        }
                        .contextMenu {
                            ShortlistRowMenu(
                                college: college,
                                remove: { pendingRemoval = college },
                                track: { Task { await track(college) } },
                                setTier: { tier in Task { await setTier(tier, college) } }
                            )
                            EssaySchoolButton(college: college) { self.error = $0 }
                        }
                    }
                    .onMove { from, to in Task { await move(section.colleges, from: from, to: to) } }
                } header: {
                    sectionHeader(section)
                }
            }
            if sections.isEmpty, let tier = filter.tier {
                Section {
                    Text("No \(tier.pluralLabel.lowercased()) yet. Choose All to see your full list.")
                        .foregroundStyle(Theme.muted)
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await store.refresh() }
    }

    private var disclaimer: String {
        var text = "Reach, target and likely are planning categories, not admission or aid guarantees. Overall admission rates are not your personal odds. Schools you add here also show on Applications as Not started; a suggested school joins them once you track or star it."
        if colleges.contains(where: CollegesShortlist.isUCCampus) {
            text += " UC campuses share one UC Application, so they count as one app slot."
        }
        return text
    }

    private func sectionHeader(_ section: CollegesTierSection) -> some View {
        HStack(spacing: Theme.Spacing.xs) {
            Circle().fill(section.tier?.tone ?? Theme.mutedSoft).frame(width: 8, height: 8)
            Text(section.title).font(.forgeDisplay(.title3)).foregroundStyle(Theme.ink)
            Text("\(section.colleges.count)").font(.forgeNumber(.subheadline)).foregroundStyle(Theme.muted)
        }
        .textCase(nil)
        .accessibilityElement(children: .combine)
    }

    private var filterMenu: some View {
        Menu {
            Picker("Show", selection: $filter) {
                ForEach(CollegesTierFilter.allCases) { Text($0.label).tag($0) }
            }
        } label: {
            Label("Filter", systemImage: filter == .all ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        }
    }

    @ViewBuilder private func trackAction(_ college: College) -> some View {
        if store.shortlistTrackedApplication(for: college) == nil {
            Button { Task { await track(college) } } label: { Label("Track", systemImage: "paperplane") }
                .tint(Theme.accent)
        }
    }

    private func move(_ section: [College], from: IndexSet, to: Int) async {
        let reordered = CollegesShortlist.moving(colleges, section: section, from: from, to: to)
        do {
            try await store.setColleges(reordered)
        } catch {
            self.error = APIError.wrap(error)
        }
    }

    private func remove(_ college: College) async {
        do {
            try await store.shortlistRemove(slug: college.slug)
            Haptics.success()
        } catch {
            self.error = APIError.wrap(error)
            Haptics.error()
        }
    }

    private func setTier(_ tier: CollegeTier, _ college: College) async {
        do {
            try await store.shortlistSetTier(tier, for: college)
            Haptics.selection()
        } catch {
            self.error = APIError.wrap(error)
        }
    }

    private func track(_ college: College) async {
        do {
            try await store.shortlistTrack(college)
            Haptics.success()
        } catch {
            self.error = APIError.wrap(error)
            Haptics.error()
        }
    }
}

/// Campuses, app slots, reaches and schools with supplements.
private struct ShortlistStats: View {
    let colleges: [College]

    var body: some View {
        let items: [(String, String)] = [
            ("Campuses", "\(colleges.count)"),
            ("App slots", "\(CollegesShortlist.applicationSlots(colleges))"),
            ("Reaches", "\(colleges.filter { $0.tier == .reach }.count)"),
            ("Supps", "\(CollegesShortlist.withSupplements(colleges))/\(colleges.count)"),
        ]
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top) { cells(items) }
            Grid(alignment: .leading, horizontalSpacing: Theme.Spacing.md, verticalSpacing: Theme.Spacing.sm) {
                GridRow { cells(Array(items.prefix(2))) }
                GridRow { cells(Array(items.suffix(2))) }
            }
        }
        .padding(.vertical, Theme.Spacing.xxs)
    }

    @ViewBuilder private func cells(_ items: [(String, String)]) -> some View {
        ForEach(items, id: \.0) { label, value in
            VStack(alignment: .leading, spacing: 2) {
                Text(value).font(.forgeDisplay(.title2)).monospacedDigit().foregroundStyle(Theme.ink)
                Text(label.uppercased()).font(.forgeEyebrow).tracking(1.2).foregroundStyle(Theme.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }
}
