import SwiftUI

/// Who is signed in, with a link to manage the Xanom account.
struct MoreAccountSection: View {
    @Environment(SessionModel.self) private var session
    @Environment(\.openURL) private var openURL

    var body: some View {
        Section {
            HStack(spacing: Theme.Spacing.sm) {
                Text(SchoolLogo.initials(for: displayName))
                    .font(.headline)
                    .foregroundStyle(Theme.canvas)
                    .frame(width: 48, height: 48)
                    .background(Theme.accent, in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(displayName).font(.forgeDisplay(.title3)).foregroundStyle(Theme.ink)
                    if let email = session.user?.email, !email.isEmpty {
                        Text(email).font(.subheadline).foregroundStyle(Theme.muted)
                    }
                }
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .combine)
            Button {
                openURL(Self.accountsURL)
            } label: {
                Label("Manage Xanom account", systemImage: "arrow.up.right.square")
            }
        } footer: {
            Text("Your applications, essays and lists follow this account to any device.")
        }
    }

    private var displayName: String {
        let name = session.user?.name.trimmingCharacters(in: .whitespaces) ?? ""
        return name.isEmpty ? "Signed in" : name
    }

    static let accountsURL = URL(string: "https://accounts.xanom.co/")!
}

/// Rebuild the hub from saved answers, or wipe it and start over.
struct MoreSetupSection: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(Router.self) private var router
    @State private var confirmReset = false
    @State private var resetting = false
    @State private var error: APIError?

    var body: some View {
        HubRebuildSection()
        Section {
            Button(role: .destructive) { confirmReset = true } label: {
                HStack {
                    Text("Reset hub and start over")
                    Spacer()
                    if resetting { ProgressView() }
                }
            }
            .disabled(resetting)
        } footer: {
            Text("Clears your profile, colleges, essay drafts and setup answers, then starts onboarding again. AI sign-ins stay connected.")
        }
        .confirmationDialog("Reset your hub?", isPresented: $confirmReset, titleVisibility: .visible) {
            Button("Reset hub", role: .destructive) { reset() }
        } message: {
            Text("This can't be undone. Export a full backup first if you might want anything back.")
        }
        .errorAlert($error)
    }

    private func reset() {
        resetting = true
        Task {
            do {
                try await store.resetHub()
                Haptics.warning()
                router.popToRoot(.more)
                router.selectedTab = .profile
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
            resetting = false
        }
    }
}

/// Privacy notes and links.
struct MoreAboutSection: View {
    @Environment(WorkspaceStore.self) private var store

    var body: some View {
        Section {
            MoreAboutPoint(systemImage: "lock", text: "Your work is saved to your Xanom account. Portal passwords are encrypted and only used to check your portals.")
            MoreAboutPoint(systemImage: "cpu", text: "AI sign-ins and copilot choices are kept on this iPhone. Connect only the account you want the copilot to use.")
            Link(destination: store.config.baseURL) {
                Label("Forge on the web", systemImage: "safari")
            }
            Link(destination: Self.sourceURL) {
                Label("Source code", systemImage: "chevron.left.forwardslash.chevron.right")
            }
            LabeledValueRow(label: "Version", value: Self.version)
        } header: {
            Text("About")
        }
    }

    static let sourceURL = URL(string: "https://github.com/neelsatyavolu/college-forge")!

    static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? ""
        return build.isEmpty ? short : "\(short) (\(build))"
    }
}

private struct MoreAboutPoint: View {
    let systemImage: String
    let text: String

    var body: some View {
        Label {
            Text(text).font(.subheadline).foregroundStyle(Theme.body)
        } icon: {
            Image(systemName: systemImage).foregroundStyle(Theme.muted)
        }
    }
}

/// Sign out, with a confirmation. Also forgets this account's AI sign-ins on the iPhone.
struct MoreSignOutSection: View {
    @Environment(SessionModel.self) private var session
    let chat: MoreChatModel
    @State private var confirm = false

    var body: some View {
        Section {
            Button("Sign out", role: .destructive) { confirm = true }
                .frame(maxWidth: .infinity)
        }
        .confirmationDialog("Sign out of Forge on this iPhone?", isPresented: $confirm, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) {
                chat.ai?.jar.clear()
                Task { await session.signOut() }
            }
        } message: {
            Text("Notifications stop on this iPhone until you sign in again.")
        }
    }
}

#if DEBUG
/// Server override for testing against a local Forge (`npm run dev`). Takes effect after relaunch.
struct DeveloperSection: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var serverURL = UserDefaults.standard.string(forKey: AppConfig.Keys.baseURL) ?? ""
    @State private var saved: Bool?

    var body: some View {
        Section {
            LabeledValueRow(label: "Server", value: store.config.baseURL.absoluteString)
            TextField("Server URL override", text: $serverURL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
            Button("Save (relaunch to apply)") {
                saved = AppConfig.setDebugBaseURL(serverURL.isEmpty ? nil : serverURL)
            }
        } header: {
            Text("Developer")
        } footer: {
            switch saved {
            case true?: Text("Saved. Quit and reopen Forge.")
            case false?: Text("Enter an http or https URL.")
            case nil: Text("Leave empty for \(AppConfig.productionURL.host() ?? "production").")
            }
        }
    }
}
#endif
