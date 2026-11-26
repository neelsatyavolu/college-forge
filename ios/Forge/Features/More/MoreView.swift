import SwiftUI

/// Screens reachable from the More tab.
enum MoreRoute: Hashable {
    case chat, notifications, share, assistants, providers
}

/// Account, copilot, notifications, sharing, connected assistants and AI providers.
struct MoreView: View {
    @Environment(Router.self) private var router
    @Environment(SessionModel.self) private var session
    @Environment(WorkspaceStore.self) private var store
    @State private var chat = MoreChatModel()

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.morePath) {
            WorkspaceGate { MoreList(chat: chat) }
                .navigationTitle("More")
                .forgeScreenBackground()
                .navigationDestination(for: MoreRoute.self) { route in
                    switch route {
                    case .chat: MoreChatView(model: chat)
                    case .notifications: MoreNotificationsView()
                    case .share: MoreShareExportView()
                    case .assistants: MoreAssistantsView()
                    case .providers: MoreProvidersView(model: chat)
                    }
                }
        }
        .task(id: session.user?.email) {
            // AI sign-in cookies are kept per account, so nothing connects until the account is known.
            if let email = session.user?.email, !email.isEmpty {
                chat.configure(api: store.api, accountEmail: email)
            } else {
                chat.disconnect()
            }
        }
        .onChange(of: router.pendingChatPrompt, initial: true) { _, prompt in
            guard let prompt else { return }
            router.pendingChatPrompt = nil
            chat.input = prompt
            var path = NavigationPath()
            path.append(MoreRoute.chat)
            router.morePath = path
        }
    }
}

private struct MoreList: View {
    @Environment(SessionModel.self) private var session
    @Environment(PushManager.self) private var push
    @Environment(WorkspaceStore.self) private var store
    let chat: MoreChatModel

    var body: some View {
        List {
            MoreAccountSection()
            Section {
                NavigationLink(value: MoreRoute.chat) {
                    MoreNavRow(title: "Copilot", detail: copilotDetail, systemImage: "sparkles", tint: Theme.coral)
                }
                .disabled(!accountKnown)
                NavigationLink(value: MoreRoute.notifications) {
                    MoreNavRow(title: "Notifications", detail: notificationDetail, systemImage: "bell.badge", tint: Theme.amber)
                }
                NavigationLink(value: MoreRoute.share) {
                    MoreNavRow(title: "Share & export", detail: shareDetail, systemImage: "square.and.arrow.up", tint: Theme.teal)
                }
                if session.parent.students > 0 {
                    Button {
                        session.showParentDashboard = true
                    } label: {
                        MoreNavRow(title: "Parent dashboard", detail: "Students you follow", systemImage: "person.2", tint: Theme.accent)
                    }
                }
            }
            Section("Connections") {
                NavigationLink(value: MoreRoute.assistants) {
                    MoreNavRow(title: "Assistants", detail: "Let Grok, ChatGPT or Claude update your list", systemImage: "point.3.connected.trianglepath.dotted", tint: Theme.accent)
                }
                NavigationLink(value: MoreRoute.providers) {
                    MoreNavRow(title: "AI providers", detail: accountKnown ? "The account the copilot runs on" : "Available once you're online", systemImage: "cpu", tint: Theme.accent)
                }
                .disabled(!accountKnown)
            }
            MoreSetupSection()
            MoreAboutSection()
            #if DEBUG
            DeveloperSection()
            #endif
            MoreSignOutSection(chat: chat)
        }
        .refreshable { await store.refresh() }
    }

    private var accountKnown: Bool { !(session.user?.email ?? "").isEmpty }

    private var copilotDetail: String {
        if !accountKnown { return "Available once you're online" }
        return chat.status == nil ? "Ask about your list, essays and deadlines" : chat.headerLabel
    }

    private var notificationDetail: String {
        switch push.authorizationStatus {
        case .notDetermined: "Get told when a portal changes"
        case .denied: "Off in iPhone Settings"
        default: "On for portal updates"
        }
    }

    private var shareDetail: String {
        let notes = store.workspace.advisorNotes.count
        let links = store.workspace.shares.filter(\.isActive).count
        if notes > 0 { return "\(notes) advisor note\(notes == 1 ? "" : "s")" }
        if links > 0 { return "\(links) active link\(links == 1 ? "" : "s")" }
        return "Advisor links, Common App pack, calendar"
    }
}

/// A list row with a tinted icon tile.
struct MoreNavRow: View {
    let title: String
    var detail: String?
    let systemImage: String
    var tint: Color = Theme.accent

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: systemImage)
                .font(.body.weight(.medium))
                .foregroundStyle(tint)
                .frame(width: 32, height: 32)
                .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: Theme.Radius.small, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(Theme.ink)
                if let detail, !detail.isEmpty {
                    Text(detail).font(.subheadline).foregroundStyle(Theme.muted).lineLimit(2)
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    MoreView().previewEnvironment()
}
