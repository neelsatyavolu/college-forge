import SwiftUI

/// Read-only advisor links: create, share, revoke.
struct MoreShareLinksSection: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var creating: MoreShareScope?
    @State private var label = ""
    @State private var busy = false
    @State private var newLink: URL?
    @State private var revoking: ShareMeta?
    @State private var error: APIError?

    private var activeShares: [ShareMeta] {
        store.workspace.shares.filter(\.isActive).sorted { $0.createdAt > $1.createdAt }
    }

    var body: some View {
        Section {
            Menu {
                ForEach(MoreShareScope.allCases) { scope in
                    Button { label = ""; creating = scope } label: {
                        Label(scope.createTitle, systemImage: scope.systemImage)
                    }
                }
            } label: {
                HStack {
                    Label("New share link", systemImage: "plus.circle.fill")
                    Spacer()
                    if busy { ProgressView() }
                }
            }
            .disabled(busy)
            if let newLink {
                MoreNewLinkRow(url: newLink)
            }
            ForEach(activeShares) { share in
                MoreShareRow(share: share, url: store.config.shareURL(token: share.token))
                    .swipeActions { Button("Revoke", role: .destructive) { revoking = share } }
                    .contextMenu {
                        Button("Copy link", systemImage: "doc.on.doc") {
                            UIPasteboard.general.url = store.config.shareURL(token: share.token)
                            Haptics.success()
                        }
                        Button("Revoke", systemImage: "xmark.circle", role: .destructive) { revoking = share }
                    }
            }
        } header: {
            Text("Advisor links")
        } footer: {
            Text("A progress link shows your applications: schools, statuses, dates, follow-ups, flags and decisions. A full link also shows your profile, school list and essay drafts. Anyone with a link can leave you notes. Neither shows portal logins or a decision you haven't opened.")
        }
        .alert(creating?.createTitle ?? "", isPresented: Binding(get: { creating != nil }, set: { if !$0 { creating = nil } }), presenting: creating) { scope in
            TextField(scope.defaultLabel, text: $label)
            Button("Create") { create(scope) }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("Who is it for? Only you see this name.")
        }
        .confirmationDialog("Revoke this link?", isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }), titleVisibility: .visible, presenting: revoking) { share in
            Button("Revoke", role: .destructive) { revoke(share) }
        } message: { share in
            Text("Anyone using “\(share.label.isEmpty ? "this link" : share.label)” loses access right away.")
        }
        .errorAlert($error)
    }

    private func create(_ scope: MoreShareScope) {
        let name = label.trimmingCharacters(in: .whitespacesAndNewlines)
        busy = true
        Task {
            do {
                let reply = try await store.postAction("create-share", fields: [
                    "scope": .string(scope.rawValue),
                    "label": .string(name.isEmpty ? scope.defaultLabel : String(name.prefix(60))),
                ])
                if let token = reply.token {
                    let url = store.config.shareURL(token: token)
                    UIPasteboard.general.url = url
                    withAnimation { newLink = url }
                }
                Haptics.success()
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
            busy = false
        }
    }

    private func revoke(_ share: ShareMeta) {
        Task {
            do {
                _ = try await store.postAction("revoke-share", fields: ["token": .string(share.token)])
                if newLink?.absoluteString.contains(share.token) == true { newLink = nil }
                Haptics.success()
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}

enum MoreShareScope: String, CaseIterable, Identifiable {
    case progress, full

    var id: String { rawValue }
    var createTitle: String { self == .progress ? "Progress link" : "Full advisor link" }
    var defaultLabel: String { self == .progress ? "Progress link" : "Advisor link" }
    var systemImage: String { self == .progress ? "list.bullet.clipboard" : "person.2" }
    var summary: String { self == .progress ? "Progress only" : "Full hub" }

    init(serverValue: String?) {
        self = serverValue == "progress" ? .progress : .full
    }
}

private struct MoreNewLinkRow: View {
    let url: URL

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Label("Link created and copied", systemImage: "checkmark.circle.fill")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.success)
            Text(url.absoluteString)
                .font(.footnote.monospaced())
                .foregroundStyle(Theme.body)
                .textSelection(.enabled)
            ShareLink(item: url) { Label("Share", systemImage: "square.and.arrow.up") }
                .buttonStyle(.forgeSecondary)
                .fixedSize()
        }
        .padding(.vertical, 4)
    }
}

private struct MoreShareRow: View {
    let share: ShareMeta
    let url: URL

    var body: some View {
        let scope = MoreShareScope(serverValue: share.scope)
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: scope.systemImage)
                .foregroundStyle(Theme.accent)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(share.label.isEmpty ? scope.defaultLabel : share.label)
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.ink)
                Text("\(scope.summary) · \(ForgeDates.ago(milliseconds: share.createdAt))")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
            Spacer()
            ShareLink(item: url) { Image(systemName: "square.and.arrow.up") }
                .buttonStyle(.borderless)
                .accessibilityLabel("Share \(share.label)")
        }
    }
}
