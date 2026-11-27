import SwiftUI

/// The Essays tab: Common App, UC and each school's supplements, with a full-screen editor per essay.
struct EssaysView: View {
    @Environment(WorkspaceStore.self) private var store

    var body: some View {
        EssaysNavigation().id(store.workspace.draftStorageKey)
    }
}

private struct EssaysNavigation: View {
    @Environment(Router.self) private var router
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var metadata = EssaysMetadata()

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.essaysPath) {
            WorkspaceGate { EssaysList() }
                .navigationTitle("Essays")
                .forgeScreenBackground()
                .navigationDestination(for: EssayRoute.self) { EssayEditorView(id: $0.id) }
        }
        .environment(metadata)
        .safeAreaInset(edge: .top) {
            if let error = metadata.error {
                ErrorBanner(message: error.message, retry: { Task { await metadata.refresh(store: store) } })
            }
        }
        .task(id: store.hasLoaded && router.selectedTab == .essays && scenePhase == .active) {
            if store.hasLoaded, router.selectedTab == .essays, scenePhase == .active {
                await metadata.refresh(store: store)
            }
        }
    }
}

/// The grouped list of every prompt.
private struct EssaysList: View {
    @Environment(EssaysMetadata.self) private var metadata
    @Environment(WorkspaceStore.self) private var store
    @Environment(Router.self) private var router
    @Environment(\.scenePhase) private var scenePhase

    @State private var expanded: Set<String>?
    @State private var knownGroupKeys: [String] = []
    @State private var byType = false
    @State private var search = ""
    @State private var promptForm: EssayPromptDraft?
    @State private var visibilityError: APIError?

    private var queue: EssayDraftQueue { EssayDraftQueues.queue(for: store) }
    private var groups: [EssayGroup] {
        EssayCatalog.groups(colleges: store.workspace.colleges, essays: store.workspace.essays,
                            hidden: store.workspace.essayHidden, commonAppPrompt: store.workspace.commonAppPrompt,
                            essaySchools: store.workspace.essaySchools)
    }
    @State private var pickingSchools = false
    private var skippedSchools: [EssaySchool] {
        EssayCatalog.schools(colleges: store.workspace.colleges, essaySchools: store.workspace.essaySchools).filter { !$0.writing }
    }

    var body: some View {
        let groups = groups
        let queue = queue
        let drafts = store.workspace.essayDrafts.merging(queue.pending) { _, local in local }
        let progress = EssayWritingProgress(groups: groups, drafts: drafts, status: metadata.status, rules: metadata.rules)
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
                if metadata.loaded {
                    EssaysOverview(progress: progress, saveState: queue.state)
                } else if metadata.error == nil {
                    Section("Writing progress") { ProgressView("Loading writing progress…") }
                }
                notWritingFor
                Picker("Sort essays", selection: $byType) {
                    Text("By school").tag(false)
                    Text("By prompt type").tag(true)
                }
                .pickerStyle(.segmented)
                if byType {
                    ForEach(EssayArchetype.sections(for: EssayCatalog.items(in: groups))) { section in
                        Section {
                            ForEach(section.items) { row($0, queue: queue, showGroup: true) }
                        } header: {
                            HStack {
                                Text(section.label)
                                Spacer()
                                Text(section.items.count, format: .number)
                            }
                        }
                    }
                } else {
                    ForEach(groups) { group in
                        section(for: group, queue: queue, unfinished: progress.unfinishedGroups.contains(group.key))
                    }
                }
            } else {
                searchResults(groups: groups, queue: queue)
            }
        }
        .listStyle(.insetGrouped)
        .overlay { emptyState(groups) }
        .searchable(text: $search, prompt: "Search prompts")
        .refreshable {
            await store.refresh()
            await metadata.refresh(store: store)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { promptForm = .new(in: EssayCatalog.commonKey) } label: {
                    Label("Add prompt", systemImage: "plus")
                }
            }
            if !store.workspace.colleges.isEmpty {
                ToolbarItem(placement: .topBarLeading) {
                    Button { pickingSchools = true } label: { Label("Pick essay schools", systemImage: "checklist") }
                }
            }
        }
        .sheet(isPresented: $pickingSchools) { EssaySchoolsSheet() }
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
        .errorAlert($visibilityError)
        .onChange(of: groups.map(\.key)) { _, _ in syncExpanded(groups) }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { EssayBackgroundSave.flush(queue) }
        }
    }

    // MARK: Sections

    @ViewBuilder
    private func section(for group: EssayGroup, queue: EssayDraftQueue, unfinished: Bool) -> some View {
        let isOpen = expanded?.contains(group.key) ?? true
        Section {
            if isOpen {
                if group.kind == .common { commonAppChoiceRow(group) }
                if group.essays.isEmpty && group.hiddenEssays.isEmpty {
                    placeholderRow(group)
                } else {
                    ForEach(group.essays) { essay in
                        row(EssayItem(essay: essay, groupKey: group.key, groupTitle: group.title), queue: queue)
                    }
                }
                if !group.hiddenEssays.isEmpty {
                    DisclosureGroup("Hidden (\(group.hiddenEssays.count))") {
                        ForEach(group.hiddenEssays) { essay in
                            row(EssayItem(essay: essay, groupKey: group.key, groupTitle: group.title), queue: queue, isHidden: true)
                        }
                    }
                    .foregroundStyle(Theme.muted)
                }
            }
        } header: {
            EssayGroupHeader(group: group, started: startedCount(group, queue), isExpanded: isOpen, unfinished: unfinished) {
                withAnimation(.snappy) { toggle(group.key) }
                Haptics.selection()
            }
        }
    }

    private func row(_ item: EssayItem, queue: EssayDraftQueue, showGroup: Bool = false, isHidden: Bool = false) -> some View {
        let text = queue.text(for: item.essay, serverDrafts: store.workspace.essayDrafts)
        return NavigationLink(value: EssayRoute(id: item.id)) {
            EssayRow(essay: item.essay, count: EssayMetrics.count(text, for: item.essay),
                     group: showGroup ? item.badge : nil, isFinal: metadata.status[item.id] == "final")
        }
        .swipeActions(edge: .trailing) {
            Button { promptForm = .editing(item) } label: { Label("Edit prompt", systemImage: "pencil") }
                .tint(Theme.accent)
            hideButton(item.essay, isHidden: isHidden).tint(Theme.muted)
        }
        .contextMenu {
            Button { promptForm = .editing(item) } label: { Label("Edit prompt", systemImage: "pencil") }
            hideButton(item.essay, isHidden: isHidden)
            if EssayMetrics.isPersonalStatement(item.essay) && store.workspace.commonAppPrompt == nil {
                Button { Task { await chooseCommonAppPrompt(item.essay.id) } } label: {
                    Label("Choose this prompt", systemImage: "checkmark.circle")
                }
            }
            if !text.isEmpty {
                Button { UIPasteboard.general.string = text } label: { Label("Copy draft", systemImage: "doc.on.doc") }
                ShareLink(item: text) { Label("Share draft", systemImage: "square.and.arrow.up") }
            }
        }
    }

    /// The schools the student isn't writing for, each with a one-tap "Add back", like the web's NotWritingFor.
    @ViewBuilder private var notWritingFor: some View {
        let skipped = skippedSchools
        if !skipped.isEmpty {
            Section {
                ForEach(skipped) { school in
                    LabeledContent(school.title) {
                        Button("Add back") { Task { await addBack(school.key) } }
                            .accessibilityLabel("Add \(school.title) back to Essays")
                    }
                }
                Button("Pick essay schools") { pickingSchools = true }
            } header: {
                Text("Not writing for")
            } footer: {
                Text("Their drafts are kept. Add a school back to see its supplements again.")
            }
        }
    }

    private func addBack(_ key: String) async {
        do {
            try await store.setEssaySchools([key: true])
            Haptics.selection()
        } catch { report(error) }
    }

    private func hideButton(_ essay: Essay, isHidden: Bool) -> some View {
        Button { Task { await setHidden(essay.id, !isHidden) } } label: {
            isHidden ? Label("Show essay", systemImage: "eye") : Label("Hide essay", systemImage: "eye.slash")
        }
        .accessibilityHint(isHidden ? "Shows this essay again and counts it" : "Hides an essay you won't write. Its draft is kept.")
    }

    /// The Common App choice, like the web's CommonAppChoice: once chosen, the other prompts drop out.
    @ViewBuilder
    private func commonAppChoiceRow(_ group: EssayGroup) -> some View {
        if store.workspace.commonAppPrompt != nil {
            Button { Task { await chooseCommonAppPrompt(nil) } } label: {
                LabeledContent("Your prompt is chosen") { Text("Change prompt").foregroundStyle(Theme.accent) }
            }
        } else if group.essays.contains(where: EssayMetrics.isPersonalStatement) {
            Menu {
                ForEach(group.essays.filter(EssayMetrics.isPersonalStatement)) { essay in
                    Button(essay.label.isEmpty ? essay.id : essay.label) { Task { await chooseCommonAppPrompt(essay.id) } }
                }
            } label: {
                LabeledContent("Choose your prompt") { Image(systemName: "chevron.up.chevron.down").foregroundStyle(Theme.accent) }
            }
        }
    }

    private func setHidden(_ id: String, _ hide: Bool) async {
        do {
            try await store.patch(.with { $0.essayHidden = [id: hide ? true : nil] }) { ws in
                ws.essayHidden[id] = hide ? true : nil
            }
            Haptics.selection()
        } catch { report(error) }
    }

    private func chooseCommonAppPrompt(_ id: String?) async {
        do {
            try await store.patch(.with { $0.commonAppPrompt = .some(id) }) { ws in ws.commonAppPrompt = id }
            Haptics.selection()
        } catch { report(error) }
    }

    private func report(_ error: Error) {
        let apiError = APIError.wrap(error)
        if apiError != .cancelled { visibilityError = apiError }
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
    let progress: EssayWritingProgress
    let saveState: EssayDraftQueue.SaveState

    var body: some View {
        Section("Writing progress") {
            LabeledContent("Essays drafted", value: "\(progress.drafted) of \(progress.required)")
            LabeledContent("Marked final", value: "\(progress.final) of \(progress.required)")
            LabeledContent("Words written", value: "\(progress.wordsWritten.formatted()) of \(progress.wordsRequired.formatted())")
            LabeledContent("Next deadline") {
                if let due = progress.next, let days = ForgeDates.daysUntil(due.date) {
                    let remaining = days == 0 ? "today" : "\(days) " + (days == 1 ? "day" : "days")
                    Text("\(due.shortDate) · \(due.school) \(due.round) (\(remaining))")
                        .foregroundStyle(days < 14 ? Theme.danger : Theme.body)
                        .multilineTextAlignment(.trailing)
                } else {
                    Text("None saved")
                }
            }
            EssaySaveStatusLabel(state: saveState)
        }
    }
}

#Preview {
    EssaysView().previewEnvironment()
}
