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
    @Environment(Router.self) private var router
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var writing: Bool
    @State private var promptExpanded = true
    @State private var promptForm: EssayPromptDraft?
    @State private var showingNotes = false

    private var text: String { queue.text(for: item.essay, serverDrafts: store.workspace.essayDrafts) }
    private var notes: [AdvisorNote] {
        store.workspace.advisorNotes.filter { $0.essayId == item.id }.sorted { $0.createdAt > $1.createdAt }
    }

    var body: some View {
        let count = EssayMetrics.count(text, for: item.essay)
        VStack(spacing: 0) {
            EssayEditorHeader(item: item, expanded: $promptExpanded)
            if queue.errorMessage != nil || (queue.storageUnavailable && queue.hasUnsaved) {
                EssaySaveErrorBanner(queue: queue)
                    .padding(.horizontal, Theme.Spacing.md)
                    .padding(.bottom, Theme.Spacing.xs)
            }
            Divider().overlay(Theme.hairline)
            editor
        }
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
        .onDisappear { Task { await queue.flush() } }
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
                Button {
                    writing = false
                    router.openChat(prompt: "Help me draft my \(item.essay.label) essay. Ask me questions first, then suggest an outline. Don't save anything until I ask.")
                } label: { Label("Ask copilot to draft", systemImage: "sparkles") }
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
    .previewEnvironment()
}
