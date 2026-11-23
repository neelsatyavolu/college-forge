import SwiftUI

/// Brings a College Apps account over: schools, statuses, dates, notes and portal logins.
struct ImportCollegeAppsSheet: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: APIError?
    @State private var result: String?

    private var canSubmit: Bool { email.contains("@") && !password.isEmpty && !busy }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Sign in with your College Apps email and password. Forge copies your schools, statuses, dates, notes and portal logins, then signs out of College Apps. Your College Apps password is used once and never saved.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.body)
                }
                Section {
                    TextField("College Apps email", text: $email)
                        .keyboardType(.emailAddress)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("College Apps password", text: $password)
                        .textContentType(.password)
                        .onSubmit(submit)
                }
                Section {
                    PrimaryButton(title: busy ? "Copying your schools…" : "Bring them over", isLoading: busy, action: submit)
                        .disabled(!canSubmit)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                } footer: {
                    if busy { Text("This can take up to a minute.") }
                }
            }
            .navigationTitle("College Apps")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Not now") { dismiss() } }
            }
            .interactiveDismissDisabled(busy)
            .errorAlert($error, title: "Couldn't bring your schools over")
            .alert("Done", isPresented: Binding(get: { result != nil }, set: { if !$0 { result = nil; dismiss() } })) {
                Button("OK") {}
            } message: {
                Text(result ?? "")
            }
        }
    }

    private func submit() {
        guard canSubmit else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                let response = try await store.perform(.importCollegeApps(email: ApplicationsValidation.trimmed(email), password: password))
                password = ""
                Haptics.success()
                result = ApplicationsValidation.importSummary(added: response.added ?? 0, linked: response.linked ?? 0)
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}
