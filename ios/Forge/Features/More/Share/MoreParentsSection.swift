import SwiftUI

/// Parents: invite by email with a level, change a level, resend, remove (app/api/parents).
struct MoreParentsSection: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var parents: [ParentLinkInfo] = []
    @State private var showingInvite = false
    @State private var busy = false
    @State private var sent: (url: URL, email: String, emailed: Bool)?
    @State private var removing: ParentLinkInfo?
    @State private var error: APIError?

    var body: some View {
        Section {
            Button {
                showingInvite = true
            } label: {
                HStack {
                    Label("Invite a parent", systemImage: "person.badge.plus")
                    Spacer()
                    if busy { ProgressView() }
                }
            }
            .disabled(busy)
            if let sent {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Label(sent.emailed ? "Invite emailed to \(sent.email)" : "The email didn't send. Share the link yourself.", systemImage: sent.emailed ? "checkmark.circle.fill" : "exclamationmark.circle")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(sent.emailed ? Theme.success : Theme.amber)
                    Text("It works once, for 14 days.").font(.footnote).foregroundStyle(Theme.muted)
                    ShareLink(item: sent.url) { Label("Share invite link", systemImage: "square.and.arrow.up") }
                        .buttonStyle(.forgeSecondary)
                        .fixedSize()
                }
                .padding(.vertical, 4)
            }
            ForEach(parents) { parent in
                MoreParentRow(parent: parent, busy: busy, setLevel: { setLevel(parent, $0) }, resend: { invite(email: parent.email, level: ParentLevel(rawValue: parent.level) ?? .basic) })
                    .swipeActions { Button(parent.isActive ? "Remove" : "Cancel", role: .destructive) { removing = parent } }
            }
        } header: {
            Text("Parents")
        } footer: {
            Text("A parent creates a Forge account with the email you invite and sees your applications read-only, on the web or in this app, at the level you choose. They never see portal logins or a decision before you open it.")
        }
        .task { await load() }
        .sheet(isPresented: $showingInvite) {
            MoreParentInviteSheet { email, level in invite(email: email, level: level) }
                .presentationDetents([.medium, .large])
        }
        .confirmationDialog(removing?.isActive == true ? "Remove this parent?" : "Cancel this invite?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible, presenting: removing) { parent in
            Button(parent.isActive ? "Remove" : "Cancel invite", role: .destructive) { remove(parent) }
        } message: { parent in
            Text(parent.isActive ? "\(parent.displayName) loses access right away." : "The invite link stops working.")
        }
        .errorAlert($error)
    }

    private func load() async {
        do { parents = try await store.api.parents() } catch { self.error = APIError.wrap(error) }
    }

    private func run(_ fields: [String: JSONValue], after: @escaping (ParentsReply) -> Void = { _ in }) {
        busy = true
        Task {
            do {
                let reply = try await store.api.parentsAction(fields)
                withAnimation { parents = reply.data }
                after(reply)
                Haptics.success()
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
            busy = false
        }
    }

    private func invite(email: String, level: ParentLevel) {
        run(["action": .string("invite"), "email": .string(email), "level": .string(level.rawValue)]) { reply in
            guard let url = reply.url.flatMap(URL.init(string:)) else { return }
            withAnimation { sent = (url, email, reply.emailed) }
        }
    }

    private func setLevel(_ parent: ParentLinkInfo, _ level: ParentLevel) {
        run(["action": .string("set-level"), "id": .string(parent.id), "level": .string(level.rawValue)])
    }

    private func remove(_ parent: ParentLinkInfo) {
        run(["action": .string("remove"), "id": .string(parent.id)])
    }
}

private struct MoreParentRow: View {
    let parent: ParentLinkInfo
    let busy: Bool
    let setLevel: (ParentLevel) -> Void
    let resend: () -> Void

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: parent.isActive ? "person.fill.checkmark" : "envelope")
                .foregroundStyle(Theme.accent)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(parent.displayName).font(.body.weight(.medium)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(detail).font(.subheadline).foregroundStyle(Theme.muted).lineLimit(2)
            }
            Spacer()
            Menu {
                Section("They see") {
                    ForEach(ParentLevel.allCases) { level in
                        Button {
                            setLevel(level)
                        } label: {
                            if level.rawValue == parent.level { Label(level.label, systemImage: "checkmark") } else { Text(level.label) }
                        }
                    }
                }
                if !parent.isActive {
                    Button("Resend invite", systemImage: "arrow.clockwise", action: resend)
                }
            } label: {
                Text(ParentLevel(rawValue: parent.level)?.label ?? "Basic")
                    .font(.subheadline.weight(.medium))
            }
            .disabled(busy)
        }
    }

    private var detail: String {
        if parent.isActive {
            let since = parent.acceptedAt.map { "Following since \(Date(milliseconds: $0).formatted(date: .abbreviated, time: .omitted))" } ?? "Following"
            return since
        }
        return parent.expired ? "Invite expired" : "Invited · hasn't accepted yet"
    }
}

private struct MoreParentInviteSheet: View {
    let send: (String, ParentLevel) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var level: ParentLevel = .basic

    private var valid: Bool {
        let e = email.trimmingCharacters(in: .whitespaces)
        return e.contains("@") && e.contains(".") && e.count <= 254
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("parent@example.com", text: $email)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Parent's email")
                }
                Section {
                    Picker("They see", selection: $level) {
                        ForEach(ParentLevel.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text(level.summary)
                }
            }
            .navigationTitle("Invite a parent")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send") {
                        send(email.trimmingCharacters(in: .whitespaces), level)
                        dismiss()
                    }
                    .disabled(!valid)
                }
            }
        }
    }
}
