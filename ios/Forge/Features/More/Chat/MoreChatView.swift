import SwiftUI

/// The copilot: a chat that can read and update the whole hub.
struct MoreChatView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(Router.self) private var router
    @Bindable var model: MoreChatModel
    @State private var confirmClear = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                    if let statusError = model.statusError {
                        ErrorBanner(message: statusError, retry: { Task { await model.loadStatus() } })
                    }
                    if model.status != nil && !model.canSend {
                        MoreChatConnectCard(label: model.headerLabel) { router.morePath.append(MoreRoute.providers) }
                    }
                    if model.messages.isEmpty && !model.isSending {
                        MoreChatIntro(workspace: store.workspace, enabled: model.canSend) { send($0) }
                    }
                    ForEach(model.messages) { message in
                        if !(message.role == .assistant && message.content.isEmpty) {
                            MoreChatBubble(message: message)
                        }
                    }
                    if model.isSending {
                        MoreChatProgress(text: model.progress)
                    }
                    Color.clear.frame(height: 1).id(bottomID)
                }
                .padding(Theme.Spacing.md)
            }
            .scrollDismissesKeyboard(.interactively)
            .defaultScrollAnchor(model.messages.isEmpty ? .top : .bottom)
            .onChange(of: model.messages.last?.content) { proxy.scrollTo(bottomID, anchor: .bottom) }
            .onChange(of: model.isSending) { proxy.scrollTo(bottomID, anchor: .bottom) }
        }
        .safeAreaInset(edge: .bottom) {
            MoreChatComposer(model: model) { send(nil) }
        }
        .navigationTitle("Copilot")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 0) {
                    Text("Copilot").font(.headline)
                    Text(model.headerLabel).font(.caption).foregroundStyle(model.canSend ? Theme.muted : Theme.coral)
                }
                .accessibilityElement(children: .combine)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("New chat", systemImage: "square.and.pencil") { confirmClear = true }
                    .disabled(model.messages.isEmpty || model.isSending)
            }
        }
        .confirmationDialog("Start a new chat?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear this chat", role: .destructive) { model.clear() }
        } message: {
            Text("Changes the copilot already saved to your hub stay.")
        }
        .background(Theme.canvas.ignoresSafeArea())
        .task { await model.loadStatus() }
    }

    private let bottomID = "chat-bottom"

    private func send(_ text: String?) {
        Haptics.tap()
        model.send(text) {
            await store.refresh()
            if model.error == nil { Haptics.success() } else { Haptics.error() }
        }
    }
}

/// Intro line and starter prompts on an empty chat.
private struct MoreChatIntro: View {
    let workspace: Workspace
    let enabled: Bool
    let send: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                ForgeMark(size: 28)
                Text(MoreChatSuggestions.intro(for: workspace))
                    .font(.body)
                    .foregroundStyle(Theme.body)
            }
            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                Eyebrow(text: "Try")
                ForEach(MoreChatSuggestions.prompts(for: workspace), id: \.self) { prompt in
                    Button { send(prompt) } label: {
                        HStack(alignment: .top) {
                            Text(prompt).multilineTextAlignment(.leading)
                            Spacer(minLength: Theme.Spacing.xs)
                            Image(systemName: "arrow.up.circle").foregroundStyle(Theme.accent)
                        }
                        .font(.subheadline)
                        .foregroundStyle(Theme.ink)
                        .padding(Theme.Spacing.sm)
                        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
                    }
                    .buttonStyle(.plain)
                    .disabled(!enabled)
                    .opacity(enabled ? 1 : 0.5)
                }
            }
        }
        .padding(.bottom, Theme.Spacing.sm)
    }
}

/// Shown when the chosen provider isn't connected.
private struct MoreChatConnectCard: View {
    let label: String
    let open: () -> Void

    var body: some View {
        Card {
            Text("Connect an AI to start").font(.headline).foregroundStyle(Theme.ink)
            Text("The copilot runs on your own Grok or ChatGPT account. The rest of Forge works without AI.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
            Button("Set up AI providers", action: open)
                .buttonStyle(.forgePrimary)
                .fixedSize()
        }
        .accessibilityHint("Currently \(label)")
    }
}

/// A typing indicator with the current progress line.
private struct MoreChatProgress: View {
    let text: String

    var body: some View {
        HStack(spacing: Theme.Spacing.xs) {
            ProgressView().controlSize(.small)
            Text(text.isEmpty ? "Working…" : text)
                .font(.footnote)
                .foregroundStyle(Theme.muted)
                .contentTransition(.opacity)
                .animation(.easeInOut, value: text)
        }
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    NavigationStack { MoreChatView(model: MoreChatModel()) }.previewEnvironment()
}
