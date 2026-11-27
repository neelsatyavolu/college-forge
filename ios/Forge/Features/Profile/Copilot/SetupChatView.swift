import SwiftUI

/// First-run setup: the student's own AI interviews them in a chat. Covers the app from `onboardingCover()`
/// and opens from Profile to redo setup.
struct SetupChatView: View {
    /// True when opened from Profile; first-run setup offers "Skip for now" instead.
    var canCancel = false

    @Environment(WorkspaceStore.self) private var store
    @Environment(SessionModel.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var model: SetupChatModel?

    var body: some View {
        NavigationStack {
            Group {
                if let model {
                    SetupChatScreen(model: model, leave: leave)
                } else {
                    LoadingView(label: "Checking your AI connection…")
                }
            }
            .forgeScreenBackground()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(canCancel ? "Save and exit" : "Skip for now", action: leave)
                        .disabled(model?.busy == true && model?.phase == "plan")
                }
            }
        }
        .interactiveDismissDisabled(true)
        .task { await prepare() }
        .onChange(of: model?.finished) { _, done in
            guard done == true else { return }
            Haptics.success()
            if canCancel { dismiss() }
        }
    }

    private func prepare() async {
        guard model == nil else { return }
        let email = session.user?.email ?? ""
        let chat = SetupChatModel(store: store, ai: MoreAIClient(api: store.api, accountEmail: email))
        model = chat
        await chat.checkAI()
        await chat.startIfReady()
    }

    private func leave() {
        Haptics.selection()
        if canCancel { dismiss() } else { OnboardingGate.skip(store) }
    }
}

/// The connect gate or the conversation.
private struct SetupChatScreen: View {
    @Bindable var model: SetupChatModel
    let leave: () -> Void

    var body: some View {
        switch model.aiConnected {
        case .none:
            LoadingView(label: "Checking your AI connection…")
        case .some(false):
            SetupConnectGate(model: model)
        case .some(true):
            SetupThread(model: model)
                .toolbar {
                    ToolbarItem(placement: .principal) { SetupProgressDots(phase: model.phase, section: model.section) }
                }
        }
    }
}

/// "Forge runs on your own AI": connect ChatGPT or Grok before the interview starts.
private struct SetupConnectGate: View {
    let model: SetupChatModel
    @State private var connecting: MoreAIProvider?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                Text("Let's set up your applications")
                    .font(.forgeDisplay(.title))
                    .foregroundStyle(Theme.ink)
                Text("Forge runs on your own AI. Connect ChatGPT or Grok and it will interview you, build a college list that fits, and research every school on it.")
                    .foregroundStyle(Theme.body)
                Text("Your answers, including what you share about money, are sent to the AI you connect. It runs on your own ChatGPT or Grok plan.")
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                if let error = model.error {
                    ErrorBanner(message: error, dismiss: { model.error = nil })
                }
                VStack(spacing: Theme.Spacing.sm) {
                    Button { connecting = .codex } label: { Text("Connect ChatGPT").frame(maxWidth: .infinity) }
                        .buttonStyle(.forgePrimary)
                    Button { connecting = .grok } label: { Text("Connect Grok").frame(maxWidth: .infinity) }
                        .buttonStyle(.forgeSecondary)
                }
                .padding(.top, Theme.Spacing.xs)
            }
            .padding(Theme.Spacing.lg)
        }
        .sheet(item: $connecting) { provider in
            MoreProviderConnectSheet(provider: provider, client: model.ai) {
                Task {
                    await model.checkAI()
                    await model.startIfReady()
                }
            }
        }
    }
}

/// Dots for the interview sections and the current step's name.
private struct SetupProgressDots: View {
    let phase: String
    let section: String

    var body: some View {
        let index = SetupChat.sectionIndex(section)
        let label = SetupChat.stepLabel(phase: phase, section: section)
        HStack(spacing: 5) {
            ForEach(Array(SetupChat.sections.enumerated()), id: \.offset) { i, _ in
                let done = phase != "interview" || i < index
                let on = phase == "interview" && i == index
                Capsule()
                    .fill(done || on ? Theme.accent : Theme.hairline)
                    .frame(width: on ? 14 : 6, height: 6)
            }
            Text(label)
                .font(.forgeNumber(.caption))
                .foregroundStyle(Theme.muted)
                .padding(.leading, 4)
        }
        .animation(.snappy, value: section)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Setup: \(label)")
    }
}

/// The conversation, its tiles and the answer box.
private struct SetupThread: View {
    @Bindable var model: SetupChatModel
    @State private var draft = ""
    @FocusState private var composerFocused: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Theme.Spacing.md) {
                    ForEach(model.shownTurns) { turn in
                        if turn.board {
                            if !model.cards.isEmpty { SetupResearchBoard(cards: model.cards) }
                        } else {
                            SetupMessage(turn: turn, live: turn.id == model.liveTurnID, model: model)
                        }
                    }
                    if !model.turns.contains(where: \.board), !model.cards.isEmpty {
                        SetupResearchBoard(cards: model.cards)
                    }
                    if !model.status.isEmpty { SetupStatusLine(text: model.status) }
                    if let error = model.error {
                        ErrorBanner(message: error, retry: { Task { await model.retry() } }, dismiss: { model.error = nil })
                    }
                    Color.clear.frame(height: 1).id(bottomID)
                }
                .padding(Theme.Spacing.md)
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(.bottom)
            .onChange(of: model.turns) { withAnimation { proxy.scrollTo(bottomID, anchor: .bottom) } }
            .onChange(of: model.status) { proxy.scrollTo(bottomID, anchor: .bottom) }
            .onChange(of: model.cards.count) { proxy.scrollTo(bottomID, anchor: .bottom) }
        }
        .safeAreaInset(edge: .bottom) { composer }
    }

    private let bottomID = "setup-bottom"

    private var composer: some View {
        HStack(alignment: .bottom, spacing: Theme.Spacing.xs) {
            TextField(model.liveTurnID == nil ? "Type your answer…" : "Or type your answer…", text: $draft, axis: .vertical)
                .lineLimit(1...8)
                .focused($composerFocused)
                .padding(.horizontal, Theme.Spacing.sm)
                .padding(.vertical, 10)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
                .disabled(model.composerLocked)
                .accessibilityLabel("Your answer")
            Button(action: submit) {
                Image(systemName: "arrow.up.circle.fill").font(.system(size: 32))
            }
            .tint(Theme.accent)
            .disabled(model.busy || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityLabel("Send")
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.xs)
        .background(.bar)
    }

    private func submit() {
        let text = draft
        draft = ""
        Haptics.tap()
        Task { await model.send(text) }
    }
}

/// One message and, on the live turn, the tiles that answer it.
private struct SetupMessage: View {
    let turn: SetupChatTurn
    let live: Bool
    let model: SetupChatModel

    var body: some View {
        let content = turn.role == "assistant" ? SetupChat.dedupe(turn.content) : turn.content
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            if !content.isEmpty {
                MoreChatBubble(message: MoreChatMessage(role: turn.role == "user" ? .user : .assistant, content: content))
            }
            if live, let ui = turn.ui {
                switch ui {
                case .question(let q):
                    SetupQuestionView(question: q, lead: content, model: model)
                case .list(let schools, let edIdea, let warning):
                    SetupListTiles(schools: schools, edIdea: edIdea, warning: warning, disabled: model.busy,
                                   approve: { keep, drop in Task { await model.approve(keep: keep, drop: drop) } },
                                   revise: { note, dropped in Task { await model.revise(note: note, dropped: dropped) } })
                case .strategy(let strategy):
                    SetupStrategyTiles(strategy: strategy, disabled: model.busy,
                                       confirm: { Task { await model.confirmStrategy() } },
                                       change: { Task { await model.send("I'd like to change the early plan.") } })
                }
            }
        }
        .transition(.opacity)
    }
}

private struct SetupStatusLine: View {
    let text: String

    var body: some View {
        HStack(spacing: Theme.Spacing.xs) {
            ProgressView().controlSize(.small)
            Text(text)
                .font(.footnote)
                .foregroundStyle(Theme.muted)
                .contentTransition(.opacity)
                .animation(.easeInOut, value: text)
        }
        .accessibilityElement(children: .combine)
    }
}
