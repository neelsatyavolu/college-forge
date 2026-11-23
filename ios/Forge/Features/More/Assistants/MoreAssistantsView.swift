import SwiftUI

/// Assistants connected over MCP (Grok, ChatGPT, Claude…), how to add one, and disconnecting them.
struct MoreAssistantsView: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var connections: [Connection]?
    @State private var loadError: APIError?
    @State private var revoking: Connection?
    @State private var error: APIError?
    @State private var copied = false

    private var serverAddress: String {
        store.config.baseURL.appending(path: "mcp").absoluteString
    }

    var body: some View {
        List {
            Section {
                Text("Let Grok, ChatGPT, Claude or another assistant keep your applications current: add schools, update statuses and dates, record decisions, add follow-ups and flags, and manage share links. It can't see your portal passwords or essays, and you approve it once with your Xanom sign-in.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.body)
            }
            Section {
                Button {
                    UIPasteboard.general.string = serverAddress
                    copied = true
                    Haptics.success()
                } label: {
                    HStack {
                        Text(serverAddress)
                            .font(.callout.monospaced())
                            .foregroundStyle(Theme.ink)
                            .textSelection(.enabled)
                        Spacer()
                        Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                            .labelStyle(.iconOnly)
                            .foregroundStyle(Theme.accent)
                    }
                }
                .accessibilityLabel("Copy server address \(serverAddress)")
            } header: {
                Text("Server address")
            }
            Section("How to add it") {
                MoreSetupSteps(title: "Grok", steps: ["Open grok.com/connectors.", "New Connector, then Custom.", "Paste the address, leave client ID and secret empty, and allow access."])
                MoreSetupSteps(title: "ChatGPT", steps: ["Settings, then Apps and connectors.", "Create a connector with the address.", "Sign in with Xanom when asked."])
                MoreSetupSteps(title: "Claude", steps: ["Settings, then Connectors.", "Add custom connector with the address.", "Sign in with Xanom when asked."])
            }
            connectedSection
        }
        .navigationTitle("Assistants")
        .forgeScreenBackground()
        .refreshable { await load() }
        .task { await load() }
        .confirmationDialog(
            dialogTitle,
            isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }),
            titleVisibility: .visible,
            presenting: revoking
        ) { connection in
            Button("Disconnect", role: .destructive) { revoke(connection) }
        } message: { connection in
            Text(Self.isThisApp(connection)
                 ? "This is a Forge iPhone app's own sign-in. If it's this iPhone, you'll need to sign in again."
                 : "\(connection.name) loses access to your applications right away.")
        }
        .errorAlert($error)
    }

    private var dialogTitle: String {
        "Disconnect \(revoking?.name ?? "this assistant")?"
    }

    @ViewBuilder
    private var connectedSection: some View {
        Section("Connected") {
            if let connections {
                if connections.isEmpty {
                    Text("No assistants connected yet.").foregroundStyle(Theme.muted)
                }
                ForEach(connections) { connection in
                    ForgeRow(title: connection.name, subtitle: subtitle(connection)) {
                        Image(systemName: Self.isThisApp(connection) ? "iphone" : "sparkles")
                            .foregroundStyle(Theme.accent)
                            .frame(width: 28)
                    }
                    .swipeActions {
                        Button("Disconnect", role: .destructive) { revoking = connection }
                    }
                    .contextMenu {
                        Button("Disconnect", systemImage: "xmark.circle", role: .destructive) { revoking = connection }
                    }
                }
            } else if let loadError {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text(loadError.message).font(.subheadline).foregroundStyle(Theme.muted)
                    Button("Try again") { Task { await load() } }
                }
            } else {
                HStack { ProgressView(); Text("Loading…").foregroundStyle(Theme.muted) }
            }
        }
    }

    private func subtitle(_ connection: Connection) -> String {
        let date = connection.createdDate.formatted(.dateTime.month(.abbreviated).day())
        let host = Self.isThisApp(connection) ? "Forge app" : connection.host
        return [host, "connected \(date)"].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    static func isThisApp(_ connection: Connection) -> Bool {
        connection.name == AppConfig.clientName
    }

    private func load() async {
        do {
            connections = try await store.api.connections()
            loadError = nil
        } catch {
            loadError = APIError.wrap(error)
        }
    }

    private func revoke(_ connection: Connection) {
        let previous = connections
        withAnimation { connections?.removeAll { $0.id == connection.id } }
        Task {
            do {
                try await store.api.revokeConnection(id: connection.id)
                Haptics.success()
                await load()
            } catch {
                connections = previous
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}

private struct MoreSetupSteps: View {
    let title: String
    let steps: [String]

    var body: some View {
        DisclosureGroup(title) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.xs) {
                    Text("\(index + 1).").font(.forgeNumber(.subheadline)).foregroundStyle(Theme.muted)
                    Text(step).font(.subheadline).foregroundStyle(Theme.body)
                }
            }
        }
    }
}

#Preview {
    NavigationStack { MoreAssistantsView() }.previewEnvironment()
}
