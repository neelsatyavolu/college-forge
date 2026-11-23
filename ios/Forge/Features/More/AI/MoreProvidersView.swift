import SwiftUI

/// Grok, ChatGPT and OpenCode: which are connected, which model each uses and which one the copilot picks.
struct MoreProvidersView: View {
    @Bindable var model: MoreChatModel
    @State private var connecting: MoreAIProvider?
    @State private var disconnecting: MoreAIProvider?
    @State private var busy: MoreAIProvider?
    @State private var error: APIError?

    var body: some View {
        List {
            Section {
                Text("The copilot runs on your own Grok or ChatGPT account. Your profile, lists, essays and application tracking work without AI.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.body)
                if let status = model.status {
                    Label {
                        Text(status.webSearchAvailable
                             ? "Web research is on, for checking current admissions information and college sites."
                             : "Web research is off here. Recommendations use the dated dataset; check current requirements on college sites.")
                    } icon: {
                        Image(systemName: status.webSearchAvailable ? "globe" : "globe.badge.chevron.backward")
                            .foregroundStyle(status.webSearchAvailable ? Theme.teal : Theme.amber)
                    }
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                }
            }
            if let statusError = model.statusError {
                Section { ErrorBanner(message: statusError, retry: { Task { await model.loadStatus() } }) }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            if let status = model.status {
                providerSections(status)
                preferredSection(status)
            } else if model.isLoadingStatus {
                Section { HStack { ProgressView(); Text("Checking connections…").foregroundStyle(Theme.muted) } }
            }
        }
        .navigationTitle("AI providers")
        .forgeScreenBackground()
        .refreshable { await model.loadStatus() }
        .task { if model.status == nil { await model.loadStatus() } }
        .sheet(item: $connecting) { provider in
            if let client = model.ai {
                MoreProviderConnectSheet(provider: provider, client: client) {
                    Task { await model.loadStatus() }
                }
            }
        }
        .confirmationDialog(
            "Disconnect \(disconnecting?.label ?? "")?",
            isPresented: Binding(get: { disconnecting != nil }, set: { if !$0 { disconnecting = nil } }),
            titleVisibility: .visible,
            presenting: disconnecting
        ) { provider in
            Button("Disconnect", role: .destructive) { disconnect(provider) }
        } message: { _ in
            Text("The copilot stops using this account until you connect it again.")
        }
        .errorAlert($error)
    }

    @ViewBuilder
    private func providerSections(_ status: MoreAIStatus) -> some View {
        ForEach(MoreAIProvider.allCases) { provider in
            if provider.canConnect || status.opencodeAvailable {
                Section {
                    MoreProviderRow(provider: provider, connected: status.isAvailable(provider))
                    if status.isAvailable(provider) && !status.models(for: provider).isEmpty {
                        modelPicker(provider, status: status)
                    }
                    actionButton(provider, connected: status.isAvailable(provider))
                }
            }
        }
    }

    private func modelPicker(_ provider: MoreAIProvider, status: MoreAIStatus) -> some View {
        let fallback = status.defaultModel(for: provider)
        return Picker("Model", selection: Binding(
            get: { model.preferences.model(for: provider, in: status) },
            set: { model.preferences.models[provider] = $0; Haptics.selection() }
        )) {
            ForEach(status.models(for: provider)) { option in
                Text(option.id == fallback ? "\(option.title) (default)" : option.title).tag(option.id)
            }
        }
    }

    @ViewBuilder
    private func actionButton(_ provider: MoreAIProvider, connected: Bool) -> some View {
        if provider.canConnect {
            if connected {
                Button("Disconnect", role: .destructive) { disconnecting = provider }
                    .disabled(busy != nil)
            } else {
                Button {
                    connecting = provider
                } label: {
                    Label("Connect \(provider.label)", systemImage: "link")
                }
                .disabled(model.ai == nil)
            }
        }
    }

    private func preferredSection(_ status: MoreAIStatus) -> some View {
        Section {
            Picker("Use for new messages", selection: Binding(
                get: { model.preferences.preferred },
                set: { model.preferences.preferred = $0; Haptics.selection() }
            )) {
                Text("Auto").tag(MoreAIProvider?.none)
                ForEach(MoreAIProvider.allCases) { provider in
                    if provider.canConnect || status.opencodeAvailable {
                        Text(provider.label).tag(Optional(provider))
                    }
                }
            }
            LabeledValueRow(label: "Selected", value: model.headerLabel)
        } footer: {
            Text("A chosen provider must be connected; messages never go through a different account. Auto uses the first available: Grok, then ChatGPT, then OpenCode. These choices are saved on this iPhone.")
        }
    }

    private func disconnect(_ provider: MoreAIProvider) {
        guard let client = model.ai else { return }
        busy = provider
        Task {
            do {
                try await client.disconnect(provider)
                Haptics.success()
            } catch {
                self.error = APIError.wrap(error)
            }
            await model.loadStatus()
            busy = nil
        }
    }
}

private struct MoreProviderRow: View {
    let provider: MoreAIProvider
    let connected: Bool

    private var blurb: String {
        switch provider {
        case .grok: "Sign in with your xAI account. Good for college research and planning."
        case .codex: "Sign in with your ChatGPT account to use your existing subscription."
        case .opencode: "Set up on the server. No sign-in needed."
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(provider == .grok ? "Grok (xAI)" : provider.label).font(.headline).foregroundStyle(Theme.ink)
                Spacer()
                Badge(text: connected ? "Connected" : "Not connected", tone: connected ? Theme.teal : Theme.mutedSoft)
            }
            Text(blurb).font(.subheadline).foregroundStyle(Theme.muted)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}
