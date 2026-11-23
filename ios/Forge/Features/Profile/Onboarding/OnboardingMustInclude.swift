import SwiftUI

/// Up to eight schools the list must keep. Added to the shortlist right away, like the web.
struct OnboardingMustIncludeSection: View {
    @Environment(WorkspaceStore.self) private var store
    @Binding var selected: [College]
    @State private var searching = false
    @State private var busySlug: String?
    @State private var error: APIError?

    var body: some View {
        Section {
            ForEach(selected) { college in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(college.name).foregroundStyle(Theme.ink)
                        let meta = Self.meta(college)
                        if !meta.isEmpty { Text(meta).font(.footnote).foregroundStyle(Theme.muted) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if busySlug == college.slug { ProgressView() }
                }
                .swipeActions {
                    Button("Remove", systemImage: "minus.circle", role: .destructive) { remove(college) }
                }
            }
            if selected.count < ProfileRules.maxMustInclude {
                Button("Add a school", systemImage: "plus") { searching = true }
            }
        } header: {
            Text("Must-include schools")
        } footer: {
            Text(selected.count >= ProfileRules.maxMustInclude
                 ? "That's the max of \(ProfileRules.maxMustInclude). Recommendations fill the rest of your list."
                 : "Optional. Recommendations keep these and fill around them.")
        }
        .sheet(isPresented: $searching) {
            OnboardingCollegeSearch(selectedSlugs: Set(selected.map(\.slug))) { college in
                try await add(college)
            }
        }
        .errorAlert($error)
    }

    static func meta(_ c: College) -> String {
        [c.location, c.admit.map { "\($0) admit" }].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func add(_ college: College) async throws {
        guard !selected.contains(where: { $0.slug == college.slug }), selected.count < ProfileRules.maxMustInclude else { return }
        let saved = try await store.api.onboardingAddMustInclude(college)
        selected = Array((selected.filter { $0.slug != saved.slug } + [saved]).prefix(ProfileRules.maxMustInclude))
        Haptics.success()
    }

    private func remove(_ college: College) {
        busySlug = college.slug
        Task {
            defer { busySlug = nil }
            do {
                try await store.api.onboardingRemoveCollege(slug: college.slug)
                selected.removeAll { $0.slug == college.slug }
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}

/// Searches every U.S. college. Tapping a result adds it and closes the sheet.
private struct OnboardingCollegeSearch: View {
    let selectedSlugs: Set<String>
    let onPick: (College) async throws -> Void

    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [College] = []
    @State private var loading = false
    @State private var adding: String?
    @State private var error: APIError?

    var body: some View {
        NavigationStack {
            List(results.prefix(10)) { college in
                let onList = selectedSlugs.contains(college.slug)
                Button { pick(college) } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(college.name).foregroundStyle(Theme.ink)
                            Text(onList ? "Added" : OnboardingMustIncludeSection.meta(college))
                                .font(.footnote).foregroundStyle(Theme.muted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        if adding == college.slug { ProgressView() }
                    }
                }
                .disabled(onList || adding != nil)
            }
            .overlay { overlay }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search any U.S. college")
            .task(id: query) { await search() }
            .navigationTitle("Add a school")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .errorAlert($error)
        }
    }

    @ViewBuilder private var overlay: some View {
        let term = query.profileTrimmed
        if loading && results.isEmpty {
            LoadingView(label: "Searching…")
        } else if term.count < 2 {
            ContentUnavailableView("Find a school", systemImage: "magnifyingglass", description: Text("Type at least two letters."))
        } else if results.isEmpty {
            ContentUnavailableView.search(text: term)
        }
    }

    private func search() async {
        let term = query.profileTrimmed
        guard term.count >= 2 else { results = []; return }
        try? await Task.sleep(for: .milliseconds(280))
        guard !Task.isCancelled else { return }
        loading = true
        defer { loading = false }
        do {
            let found = try await store.api.onboardingSearchColleges(term)
            guard !Task.isCancelled else { return }
            results = found
        } catch {
            let e = APIError.wrap(error)
            if e != .cancelled { self.error = e }
        }
    }

    private func pick(_ college: College) {
        adding = college.slug
        Task {
            defer { adding = nil }
            do {
                try await onPick(college)
                dismiss()
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}
