import SwiftUI
import UIKit

/// The private forwarding address for portal setup emails, and the birthdate portals sometimes ask for.
struct ForwardEmailsSheet: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var inbox: InboxStatus?
    @State private var busy = false
    @State private var loadFailed = false
    @State private var copied = false
    @State private var confirmOff = false
    @State private var birthdate = Calendar.current.date(byAdding: .year, value: -17, to: .now) ?? .now
    @State private var error: APIError?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("After you apply, schools email you a link or PIN to set up your applicant portal. Forward that email to your private address and Forge sets up the portal with a strong password, saves the login and starts checking it.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.body)
                }
                content
            }
            .navigationTitle("Forward portal emails")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { await run(.inbox()) }
            .confirmationDialog("Turn off forwarding?", isPresented: $confirmOff, titleVisibility: .visible) {
                Button("Turn off", role: .destructive) { Task { await run(.inbox(on: false)) } }
            } message: {
                Text("Emails sent to this address will stop reaching Forge.")
            }
            .errorAlert($error)
        }
    }

    @ViewBuilder private var content: some View {
        if let inbox, let address = inbox.address {
            Section("Your forwarding address") {
                Text(address).font(.body.monospaced()).foregroundStyle(Theme.ink).textSelection(.enabled)
                Button {
                    UIPasteboard.general.string = address
                    copied = true
                    Haptics.success()
                } label: {
                    Label(copied ? "Copied" : "Copy address", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                Button("New address") { Task { await run(.inbox(on: true, newAddress: true)) } }
                Button("Turn off", role: .destructive) { confirmOff = true }
            }
            .disabled(busy)
            Section {
                DatePicker("Birthdate", selection: $birthdate, in: ...Date.now, displayedComponents: .date)
                Button("Save birthdate") { Task { await run(.inbox(on: true, birthdate: ForgeDates.iso(birthdate))) } }
                    .disabled(busy)
            } header: {
                Text("For portals that ask")
            } footer: {
                Text(inbox.birthdate ? "A birthdate is saved. Save again to replace it." : "Some portals ask for your birthdate during setup.")
            }
        } else if inbox != nil {
            Section {
                PrimaryButton(title: "Get my forwarding address", isLoading: busy) { Task { await run(.inbox(on: true)) } }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
        } else if loadFailed {
            Section {
                Button("Try again") { Task { await run(.inbox()) } }
            }
        } else {
            Section { HStack { Spacer(); ProgressView(); Spacer() } }
        }
    }

    private func run(_ action: ApplicationAction) async {
        busy = true
        loadFailed = false
        defer { busy = false }
        do {
            let response = try await store.perform(action)
            if let status = response.inbox {
                if status.address != inbox?.address { copied = false }
                inbox = status
            }
        } catch {
            if inbox == nil { loadFailed = true }
            self.error = APIError.wrap(error)
        }
    }
}
