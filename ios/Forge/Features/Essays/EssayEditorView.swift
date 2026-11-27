import SwiftUI

/// Full-screen writing view for one essay. Text saves on its own a moment after typing stops.
struct EssayEditorView: View {
    let id: String

    @Environment(WorkspaceStore.self) private var store

    var body: some View {
        let groups = EssayCatalog.groups(colleges: store.workspace.colleges, essays: store.workspace.essays)
        if let item = EssayCatalog.items(in: groups).first(where: { $0.id == id }) {
            EssayEditorContent(item: item, groups: groups, queue: EssayDraftQueues.queue(for: store))
        } else {
            ContentUnavailableView("Essay not found", systemImage: "doc.questionmark",
                                   description: Text("This prompt was removed from your workspace."))
                .forgeScreenBackground()
        }
    }
}

private struct EssayEditorContent: View {
    let item: EssayItem
    let groups: [EssayGroup]
    let queue: EssayDraftQueue

    @Environment(WorkspaceStore.self) private var store
    @Environment(EssaysMetadata.self) private var metadata
    @Environment(Router.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var writing: Bool
    @State private var promptExpanded = true
    @State private var promptForm: EssayPromptDraft?
    @State private var showingNotes = false
    @State private var busy = false
    @State private var error: APIError?
    @State private var visible = false

    private var text: String { queue.text(for: item.essay, serverDrafts: store.workspace.essayDrafts) }
    private var notes: [AdvisorNote] {
        store.workspace.advisorNotes.filter { $0.essayId == item.id }.sorted { $0.createdAt > $1.createdAt }
    }

    var body: some View {
        let count = EssayMetrics.count(text, for: item.essay)
        GeometryReader { geometry in
            VStack(spacing: 0) {
                ViewThatFits(in: .vertical) {
                    editorHeader.fixedSize(horizontal: false, vertical: true)
                    ScrollView { editorHeader }
                }
                .frame(maxHeight: geometry.size.height * 0.55, alignment: .top)
                Divider().overlay(Theme.hairline)
                editor
            }
        }
        .disabled(busy)
        .background(Theme.canvas.ignoresSafeArea())
        .safeAreaInset(edge: .bottom) {
            if !writing { EssayCountBar(essay: item.essay, count: count, state: queue.state) }
        }
        .navigationTitle(item.groupTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar(count: count) }
        .sheet(item: $promptForm) { draft in
            EssayPromptFormView(draft: draft, groups: groups)
        }
        .sheet(isPresented: $showingNotes) {
            EssayAdvisorNotesSheet(notes: notes)
                .presentationDetents([.medium, .large])
        }
        .sensoryFeedback(.warning, trigger: EssayMetrics.isOver(count, item.essay)) { _, isOver in isOver }
        .onChange(of: writing) { _, isWriting in
            withAnimation(.snappy) { promptExpanded = !isWriting }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { EssayBackgroundSave.flush(queue) }
        }
        .onAppear { visible = true }
        .onDisappear {
            visible = false
            Task { await queue.flush() }
        }
        .errorAlert($error)
    }

    private var editorHeader: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            EssayEditorHeader(item: item, expanded: $promptExpanded)
            if !writing { draftActions }
            if queue.errorMessage != nil || (queue.storageUnavailable && queue.hasUnsaved) {
                EssaySaveErrorBanner(queue: queue)
                    .padding(.horizontal, Theme.Spacing.md)
            }
        }
        .padding(.bottom, Theme.Spacing.xs)
    }

    @ViewBuilder
    private var draftActions: some View {
        ScrollView(.horizontal) {
            HStack {
                ForEach(EssayCopilotAction.allCases, id: \.self) { action in
                    Button(action.rawValue) { askCopilot(action) }
                }
            }
            .padding(.horizontal, Theme.Spacing.md)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)

        if let suggestion = metadata.suggestions[item.id] {
            EssaySuggestionPanel(text: suggestion, essay: item.essay,
                                 replace: { applySuggestion(suggestion) },
                                 dismiss: { update(.dismiss(id: item.id)) })
                .padding(.horizontal, Theme.Spacing.md)
        }

        if !text.contains(where: { !$0.isWhitespace }) {
            let drafts = store.workspace.essayDrafts.merging(queue.pending) { _, local in local }
            // A turned-off school's drafts aren't offered as copy sources.
            let shown = groups.filter { $0.kind == .orphan || !EssayCatalog.isSkipped($0.key, essaySchools: store.workspace.essaySchools) }
            let sources = EssayArchetype.copySources(for: item.essay, items: EssayCatalog.items(in: shown), drafts: drafts)
            if !sources.isEmpty {
                Menu("Start from a copy of another draft") {
                    ForEach(sources) { source in
                        Button(source.label) { queue.edit(id: item.id, text: source.text) }
                    }
                }
                .padding(.horizontal, Theme.Spacing.md)
            }
        }
        let final = metadata.status[item.id] == "final"
        Button(final ? "Final · Undo" : "Mark final") {
            update(.final(id: item.id, marked: !final))
        }
        .disabled(!metadata.loaded || (!final && !text.contains(where: { !$0.isWhitespace })))
        .padding(.horizontal, Theme.Spacing.md)
    }

    private func askCopilot(_ action: EssayCopilotAction) {
        performAction {
            await queue.flush()
            guard queue.isCurrent(), queue.state == .saved, visible else { return }
            router.openChat(prompt: action.prompt(for: item))
        }
    }

    private func applySuggestion(_ suggestion: String) {
        performAction {
            queue.edit(id: item.id, text: suggestion)
            await queue.flush()
            guard queue.isCurrent(), queue.state == .saved else { return }
            try await metadata.apply(.dismiss(id: item.id), store: store)
        }
    }

    private func update(_ patch: EssaysMetadataPatch) {
        performAction {
            guard queue.isCurrent() else { return }
            try await metadata.apply(patch, store: store)
        }
    }

    private func performAction(_ operation: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }
        busy = true
        writing = false
        Task {
            defer { busy = false }
            do { try await operation() }
            catch { self.error = APIError.wrap(error) }
        }
    }

    private var editor: some View {
        TextEditor(text: Binding(get: { text }, set: { queue.edit(id: item.id, text: $0) }))
            .font(.system(.body, design: .serif))
            .lineSpacing(6)
            .foregroundStyle(Theme.ink)
            .scrollContentBackground(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .padding(.horizontal, Theme.Spacing.sm)
            .focused($writing)
            .overlay(alignment: .topLeading) {
                if text.isEmpty {
                    Text("Start writing, or paste a draft. It saves to your hub, so it's on every device.")
                        .font(.system(.body, design: .serif))
                        .foregroundStyle(Theme.mutedSoft)
                        .padding(.horizontal, Theme.Spacing.md + 1)
                        .padding(.top, 8)
                        .allowsHitTesting(false)
                }
            }
            .accessibilityLabel("\(item.essay.label) draft")
    }

    @ToolbarContentBuilder
    private func toolbar(count: Int) -> some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Menu {
                Button { promptForm = .editing(item) } label: { Label("Edit prompt", systemImage: "pencil") }
                if !notes.isEmpty {
                    Button { showingNotes = true } label: {
                        Label("Advisor notes (\(notes.count))", systemImage: "text.bubble")
                    }
                }
                if !text.isEmpty {
                    Button { UIPasteboard.general.string = text } label: { Label("Copy draft", systemImage: "doc.on.doc") }
                    ShareLink(item: text, subject: Text(item.essay.label)) {
                        Label("Share draft", systemImage: "square.and.arrow.up")
                    }
                }
            } label: {
                Label("More", systemImage: "ellipsis.circle")
            }
        }
        if !notes.isEmpty {
            ToolbarItem(placement: .primaryAction) {
                Button { showingNotes = true } label: { Label("Advisor notes", systemImage: "text.bubble") }
                    .accessibilityValue("\(notes.count)")
            }
        }
        ToolbarItemGroup(placement: .keyboard) {
            EssayKeyboardCount(essay: item.essay, count: count, state: queue.state)
            Spacer()
            Button { withAnimation(.snappy) { promptExpanded.toggle() } } label: {
                Label(promptExpanded ? "Hide prompt" : "Show prompt", systemImage: "text.quote")
            }
            Button("Done") { writing = false }.fontWeight(.semibold)
        }
    }
}

#Preview {
    NavigationStack {
        EssayEditorView(id: "ca-1")
    }
    .environment(EssaysMetadata())
    .previewEnvironment()
}
