import SwiftUI

/// Whether a portal login is saved, and forms to save, replace or forget it. The saved password is never shown.
struct PortalLoginSection: View {
    let app: TrackedApplication
    @Environment(WorkspaceStore.self) private var store
    @State private var editing = false
    @State private var confirmForget = false
    @State private var error: APIError?

    var body: some View {
        Section {
            if let login = app.login {
                LabeledContent {
                    Text(login.username).foregroundStyle(Theme.ink).textSelection(.enabled)
                } label: {
                    Label("Saved for", systemImage: "person.badge.key")
                }
                if !login.hasPassword {
                    Text("No password saved, so Forge can't check this portal.").font(.subheadline).foregroundStyle(Theme.amber)
                }
                Button("Replace login") { editing = true }
                Button("Forget login", role: .destructive) { confirmForget = true }
            } else {
                Button { editing = true } label: { Label("Save portal login", systemImage: "key") }
            }
        } header: {
            Text("Portal login")
        } footer: {
            Text("Forge signs in to check your status every 12 hours. Passwords are encrypted and never shown again, not even to assistants you connect.")
        }
        .sheet(isPresented: $editing) { PortalLoginSheet(app: app) }
        .confirmationDialog("Forget the login for \(app.name)?", isPresented: $confirmForget, titleVisibility: .visible) {
            Button("Forget login", role: .destructive, action: forget)
        } message: {
            Text("Forge will stop checking this portal.")
        }
        .errorAlert($error)
    }

    private func forget() {
        Task {
            do {
                try await store.perform(.forgetLogin(id: app.id))
                Haptics.success()
            } catch {
                self.error = APIError.wrap(error)
            }
        }
    }
}

private struct PortalLoginSheet: View {
    let app: TrackedApplication
    @Environment(WorkspaceStore.self) private var store
    @Environment(PortalCheckModel.self) private var checks
    @Environment(\.dismiss) private var dismiss
    @State private var username: String
    @State private var password = ""
    @State private var saving = false
    @State private var error: APIError?

    init(app: TrackedApplication) {
        self.app = app
        _username = State(initialValue: app.login?.username ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Username or email", text: $username)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField(app.login == nil ? "Password" : "New password", text: $password)
                        .textContentType(.password)
                } footer: {
                    Text("Use the login for \(app.portalName). Forge encrypts the password and never shows it again.")
                }
            }
            .navigationTitle(app.login == nil ? "Save login" : "Replace login")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("Save", action: save)
                            .disabled(!ApplicationsValidation.canSaveLogin(username: username, password: password))
                    }
                }
            }
            .errorAlert($error)
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        saving = true
        Task {
            defer { saving = false }
            do {
                try await store.perform(.login(id: app.id, username: ApplicationsValidation.trimmed(username), password: password))
                password = ""
                Haptics.success()
                dismiss()
                // Fill in the portal status straight away, as the web does after "Check now".
                if let saved = store.application(id: app.id) {
                    await checks.check([saved], store: store)
                }
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}
