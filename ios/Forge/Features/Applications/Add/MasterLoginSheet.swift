import SwiftUI

/// One username and password for many portals. Encrypted like every portal login, never shown again, and
/// used only on schools the student turns it on for (one at a time, or every catalog portal without a login).
struct MasterLoginSheet: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var master: MasterLoginStatus?
    @State private var username = ""
    @State private var password = ""
    @State private var busy = false
    @State private var confirmForget = false
    @State private var notice: String?
    @State private var error: APIError?

    private var withoutLogin: Int {
        store.applications.filter { $0.collegeId != nil && !$0.portalUrl.isEmpty && !($0.login?.hasPassword ?? false) }.count
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Username or email", text: $username, prompt: Text("Your account email"))
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField(master?.on == true ? "New password" : "Password", text: $password)
                        .textContentType(.password)
                    Button(master?.on == true ? "Replace master login" : "Save master login") { Task { await save() } }
                        .disabled(busy || password.isEmpty)
                } footer: {
                    Text(master?.on == true
                        ? "In use on \(master?.appCount ?? 0) school\(master?.appCount == 1 ? "" : "s"). Changing it here doesn't change it on your portals, so change it there first."
                        : "If you use the same login on many portals, save it once. Forge only uses it on schools you turn it on for.")
                }
                if master?.on == true {
                    Section {
                        Button("Use for all portals without a login\(withoutLogin > 0 ? " (\(withoutLogin))" : "")") {
                            Task { await run(.applyMasterAll, done: "Master login turned on for those portals.") }
                        }
                        .disabled(busy || withoutLogin == 0)
                        Button("Forget master login", role: .destructive) { confirmForget = true }
                            .disabled(busy)
                    } footer: {
                        if let notice { Text(notice) }
                    }
                }
            }
            .navigationTitle("Master login")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { await load() }
            .confirmationDialog("Forget the master login?", isPresented: $confirmForget, titleVisibility: .visible) {
                Button("Forget", role: .destructive) { Task { await run(.forgetMaster, done: "Master login removed.") } }
            } message: {
                Text("Schools using it stop being checked until you save a login for them.")
            }
            .errorAlert($error)
        }
        .presentationDetents([.medium, .large])
    }

    private func load() async {
        do {
            master = try await store.api.masterLogin()
            if username.isEmpty { username = master?.username ?? "" }
        } catch {
            self.error = APIError.wrap(error)
        }
    }

    private func save() async {
        await run(.masterLogin(username: ApplicationsValidation.trimmed(username), password: password), done: "Master login saved.")
        password = ""
    }

    private func run(_ action: ApplicationAction, done: String) async {
        busy = true
        defer { busy = false }
        do {
            let response = try await store.perform(action)
            if let status = response.master { master = status }
            notice = done
            Haptics.success()
        } catch {
            self.error = APIError.wrap(error)
            Haptics.error()
        }
    }
}
