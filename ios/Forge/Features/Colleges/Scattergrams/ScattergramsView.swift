import SwiftUI

/// Push this on the Colleges tab to show the imported Maia scattergrams.
struct ScattergramsRoute: Hashable {}

/// Where past applicants from the student's high school landed, by GPA and SAT, for each school imported
/// from Maia Learning on the website. Read-only here: importing needs a computer's browser. The data stays in
/// this view's memory only.
struct ScattergramsView: View {
    private enum LoadState {
        case loading, loaded(ScattergramDoc?), failed(APIError)
    }

    private static let othersPage = 12

    @Environment(WorkspaceStore.self) private var store
    @State private var state = LoadState.loading
    @State private var query = ""
    @State private var othersShown = Self.othersPage
    @State private var confirmingDelete = false
    @State private var deleting = false
    @State private var error: APIError?

    var body: some View {
        content
            .navigationTitle("Scattergrams")
            .navigationBarTitleDisplayMode(.inline)
            .forgeScreenBackground()
            .task { await load() }
            .toolbar {
                if doc != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button("Delete imported data", systemImage: "trash", role: .destructive) { confirmingDelete = true }
                        } label: {
                            Label("Options", systemImage: "ellipsis.circle")
                        }
                        .disabled(deleting)
                    }
                }
            }
            .confirmationDialog(
                "Delete all imported Maia scattergram data from this workspace?",
                isPresented: $confirmingDelete,
                titleVisibility: .visible
            ) {
                Button("Delete imported data", role: .destructive) { Task { await delete() } }
                Button("Cancel", role: .cancel) {}
            }
            .errorAlert($error)
    }

    private var doc: ScattergramDoc? {
        if case .loaded(let doc) = state { return doc }
        return nil
    }

    @ViewBuilder private var content: some View {
        switch state {
        case .loading:
            LoadingView(label: "Loading scattergrams…")
        case .failed(let apiError):
            ErrorStateView(error: apiError) { await load() }
        case .loaded(nil):
            ScrollView {
                EmptyStateView(systemImage: "chart.dots.scatter", title: "No scattergrams yet", message: Self.emptyMessage)
                    .padding(.top, Theme.Spacing.xl)
            }
            .refreshable { await load() }
        case .loaded(let doc?):
            list(doc)
        }
    }

    private func list(_ doc: ScattergramDoc) -> some View {
        let student = ScattergramLogic.studentMarker(doc: doc, applicant: store.workspace.applicant)
        let sections = ScattergramLogic.sections(doc: doc, list: store.workspace.colleges, query: query)
        return List {
            Section {
                ScattergramsIntro(doc: doc, student: student)
            } footer: {
                Text(Self.privacyNote)
            }
            ForEach(sections.onList) { college in
                Section { ScattergramCard(college: college, student: student) }
            }
            if !sections.notImported.isEmpty {
                Section {
                    Text("Not imported yet: \(sections.notImported.joined(separator: ", ")). Run the Maia bookmark from the website again to add them.")
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                }
            }
            othersSection(sections.others, student: student)
            if sections.onList.isEmpty, sections.others.isEmpty, !query.isEmpty {
                Section {
                    Text("No imported school matches “\(query)”.").foregroundStyle(Theme.muted)
                }
            }
        }
        .listStyle(.insetGrouped)
        .searchable(text: $query, prompt: "Find an imported school")
        .refreshable { await load() }
    }

    @ViewBuilder private func othersSection(_ others: [CollegeScattergram], student: ScatterStudentMarker?) -> some View {
        if !others.isEmpty {
            Section {
                Text("\(others.count) imported school\(others.count == 1 ? "" : "s") not on your list, ranked schools first.")
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
            } header: {
                Text("Other schools").font(.forgeDisplay(.title3)).foregroundStyle(Theme.ink).textCase(nil)
            }
            ForEach(others.prefix(othersShown)) { college in
                Section { ScattergramCard(college: college, student: student) }
            }
            if othersShown < others.count {
                Section {
                    Button("Show more (\(others.count - othersShown) left)") { othersShown += Self.othersPage }
                        .tint(Theme.accent)
                }
            }
        }
    }

    private func load() async {
        do {
            let loaded = try await store.api.scattergrams()
            state = .loaded(loaded)
        } catch {
            let apiError = APIError.wrap(error)
            guard apiError != .cancelled else { return }
            if doc == nil { state = .failed(apiError) } else { self.error = apiError }
        }
    }

    private func delete() async {
        deleting = true
        defer { deleting = false }
        do {
            try await store.api.deleteScattergrams()
            state = .loaded(nil)
            othersShown = Self.othersPage
            Haptics.success()
        } catch {
            self.error = APIError.wrap(error)
            Haptics.error()
        }
    }

    static let emptyMessage = "If your high school uses Maia Learning, you can bring in its scattergrams: where past applicants from your school landed, by GPA and SAT. Import them on a computer from Scattergrams on the College Forge website, using the Maia bookmark there. They show up here once imported."

    static let privacyNote = "The data describes real students from your school, so it stays private to your workspace and is left out of share links and exports."
}

/// The lede, import date, the student's own numbers and the legend.
private struct ScattergramsIntro: View {
    let doc: ScattergramDoc
    let student: ScatterStudentMarker?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("Where past applicants from your high school landed, by GPA and SAT.")
                .font(.subheadline)
                .foregroundStyle(Theme.body)
            if let imported = ScattergramLogic.importedLabel(doc) {
                Text(imported.uppercased()).font(.forgeEyebrow).tracking(1.2).foregroundStyle(Theme.muted)
            }
            if let student {
                Text(ScattergramLogic.studentLine(student)).font(.footnote).foregroundStyle(Theme.muted)
            }
            ScattergramLegend(hasStudent: student != nil)
        }
        .padding(.vertical, Theme.Spacing.xxs)
    }
}

/// One school: rank and name, applicant counts, the chart and a note about unplotted applicants.
private struct ScattergramCard: View {
    let college: CollegeScattergram
    let student: ScatterStudentMarker?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.xs) {
                if let rank = college.rank {
                    Text("#\(rank)").font(.forgeNumber(.subheadline)).foregroundStyle(Theme.muted)
                }
                Text(college.name).font(.forgeDisplay(.title3)).foregroundStyle(Theme.ink)
            }
            .accessibilityElement(children: .combine)
            Text(ScattergramLogic.headline(college)).font(.footnote).foregroundStyle(Theme.muted)
            if college.n == 0 {
                Text("Maia has no past applicants from your school for this college.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            } else {
                ScattergramChart(college: college, student: student)
                let unplotted = ScattergramLogic.unplotted(college)
                if unplotted > 0 {
                    Text("\(unplotted) applicant\(unplotted == 1 ? "" : "s") without both SAT and GPA aren’t plotted.")
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                }
            }
        }
        .padding(.vertical, Theme.Spacing.xxs)
    }
}

#Preview {
    NavigationStack { ScattergramsView() }.previewEnvironment()
}
