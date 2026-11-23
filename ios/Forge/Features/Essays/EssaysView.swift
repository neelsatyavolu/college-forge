import SwiftUI

/// The Essays tab: Common App, UC and each school's supplements, with a full-screen editor per essay.
struct EssaysView: View {
    @Environment(Router.self) private var router

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.essaysPath) {
            WorkspaceGate { EssaysList() }
                .navigationTitle("Essays")
                .forgeScreenBackground()
                .navigationDestination(for: EssayRoute.self) { EssayEditorView(id: $0.id) }
        }
    }
}

/// The grouped list of every prompt.
private struct EssaysList: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.scenePhase) private var scenePhase

    @State private var expanded: Set<String>?
    @State private var knownGroupKeys: [String] = []
    @State private var search = ""
    @State private var promptForm: EssayPromptDraft?

    private var queue: EssayDraftQueue { EssayDraftQueues.queue(for: store) }
    private var groups: [EssayGroup] { EssayCatalog.groups(colleges: store.workspace.colleges, essays: store.workspace.essays) }

    var body: some View {
        let groups = groups
        let queue = queue
        List {
            if let refreshError = store.refreshError {
                ErrorBanner(message: refreshError.message, retry: { Task { await store.refresh() } },
                            dismiss: { store.refreshError = nil })
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            }
            if queue.errorMessage != nil || (queue.storageUnavailable && queue.hasUnsaved) {
                EssaySaveErrorBanner(queue: queue)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            }
            if search.isEmpty {
                EssaysOverview(groups: groups, queue: queue, drafts: store.workspace.essayDrafts)
                ForEach(groups) { section(for: $0, queue: queue) }
            } else {
                searchResults(groups: groups, queue: queue)
            }
        }
        .listStyle(.insetGrouped)
        .overlay { emptyState(groups) }
        .searchable(text: $search, prompt: "Search prompts")
        .refreshable { await store.refresh() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { promptForm = .new(in: EssayCatalog.commonKey) } label: {
                    Label("Add prompt", systemImage: "plus")
                }
            }
        }
        .sheet(item: $promptForm) { draft in
            EssayPromptFormView(draft: draft, groups: groups) { id in
                expanded?.insert(draft.groupKey)
                if !draft.isEditing { router.essaysPath.append(EssayRoute(id: id)) }
            }
            .presentationDetents([.large])
        }
        .onAppear {
            syncExpanded(groups)
            Task { await queue.flush() }
        }
        .onChange(of: groups.map(\.key)) { _, _ in syncExpanded(groups) }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { EssayBackgroundSave.flush(queue) }
        }
    }

    // MARK: Sections

    @ViewBuilder
    private func section(for group: EssayGroup, queue: EssayDraftQueue) -> some View {
        let isOpen = expanded?.contains(group.key) ?? true
        Section {
            if isOpen {
                if group.essays.isEmpty {
                    placeholderRow(group)
                } else {
                    ForEach(group.essays) { essay in
                        row(EssayItem(essay: essay, groupKey: group.key, groupTitle: group.title), queue: queue)
                    }
                }
            }
        } header: {
            EssayGroupHeader(group: group, started: startedCount(group, queue), isExpanded: isOpen) {
                withAnimation(.snappy) { toggle(group.key) }
                Haptics.selection()
            }
        }
    }

    private func row(_ item: EssayItem, queue: EssayDraftQueue) -> some View {
        let text = queue.text(for: item.essay, serverDrafts: store.workspace.essayDrafts)
        return NavigationLink(value: EssayRoute(id: item.id)) {
            EssayRow(essay: item.essay, count: EssayMetrics.count(text, for: item.essay))
        }
        .swipeActions(edge: .trailing) {
            Button { promptForm = .editing(item) } label: { Label("Edit prompt", systemImage: "pencil") }
                .tint(Theme.accent)
        }
        .contextMenu {
            Button { promptForm = .editing(item) } label: { Label("Edit prompt", systemImage: "pencil") }
            if !text.isEmpty {
                Button { UIPasteboard.general.string = text } label: { Label("Copy draft", systemImage: "doc.on.doc") }
                ShareLink(item: text) { Label("Share draft", systemImage: "square.and.arrow.up") }
            }
        }
    }

    private func placeholderRow(_ group: EssayGroup) -> some View {
        Button { promptForm = .new(in: group.key) } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text("No prompts yet").font(.subheadline).foregroundStyle(Theme.ink)
                Text("Add one from this school's application.").font(.caption).foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityHint("Adds a prompt for \(group.title)")
    }

    @ViewBuilder
    private func searchResults(groups: [EssayGroup], queue: EssayDraftQueue) -> some View {
        let query = search.trimmingCharacters(in: .whitespaces)
        let matches = EssayCatalog.items(in: groups).filter {
            $0.essay.label.localizedCaseInsensitiveContains(query)
                || $0.essay.prompt.localizedCaseInsensitiveContains(query)
                || $0.groupTitle.localizedCaseInsensitiveContains(query)
        }
        if matches.isEmpty {
            ContentUnavailableView.search(text: query).listRowBackground(Color.clear)
        } else {
            ForEach(matches) { item in
                Section(item.groupTitle) { row(item, queue: queue) }
            }
        }
    }

    @ViewBuilder
    private func emptyState(_ groups: [EssayGroup]) -> some View {
        let schools = groups.filter { $0.kind == .school || $0.kind == .uc }.count
        if search.isEmpty && schools == 0 && groups.allSatisfy(\.essays.isEmpty) {
            EmptyStateView(systemImage: "doc.text", title: "No essay prompts yet",
                           message: "Common App prompts load on their own. Pull to refresh, or add schools to your list to see their supplements.",
                           actionTitle: "Add prompt") { promptForm = .new(in: EssayCatalog.commonKey) }
                .background(Theme.canvas)
        }
    }

    // MARK: State

    private func startedCount(_ group: EssayGroup, _ queue: EssayDraftQueue) -> Int {
        group.essays.filter {
            EssayMetrics.wordCount(queue.text(for: $0, serverDrafts: store.workspace.essayDrafts)) > 0
        }.count
    }

    private func toggle(_ key: String) {
        var next = expanded ?? []
        if next.contains(key) { next.remove(key) } else { next.insert(key) }
        expanded = next
    }

    /// Sets the default open groups once, then opens newly added schools (like the web sidebar).
    private func syncExpanded(_ groups: [EssayGroup]) {
        let keys = groups.map(\.key)
        guard keys != knownGroupKeys else { return }
        if var open = expanded {
            open.insert(EssayCatalog.commonKey)
            for group in groups where group.kind == .school && !knownGroupKeys.contains(group.key) {
                open.insert(group.key)
            }
            expanded = open
        } else if store.hasLoaded {
            expanded = EssayCatalog.initiallyExpanded(groups, drafts: store.workspace.essayDrafts)
        }
        knownGroupKeys = keys
    }
}

/// The summary at the top of the list.
private struct EssaysOverview: View {
    let groups: [EssayGroup]
    let queue: EssayDraftQueue
    let drafts: [String: String]

    var body: some View {
        let essays = groups.flatMap(\.essays)
        let started = essays.filter { EssayMetrics.wordCount(queue.text(for: $0, serverDrafts: drafts)) > 0 }.count
        Section {
            HStack(spacing: Theme.Spacing.md) {
                ProgressRing(progress: essays.isEmpty ? 0 : Double(started) / Double(essays.count),
                             lineWidth: 5, tint: Theme.teal, label: "\(started)/\(essays.count)", size: 52)
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(started) of \(essays.count) started")
                        .font(.forgeDisplay(.headline))
                        .foregroundStyle(Theme.ink)
                    Text("Personal statement: 250–650 words. Check each prompt against the current application.")
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    EssaySaveStatusLabel(state: queue.state)
                }
            }
            .padding(.vertical, 4)
        }
    }
}

#Preview {
    EssaysView().previewEnvironment()
}
