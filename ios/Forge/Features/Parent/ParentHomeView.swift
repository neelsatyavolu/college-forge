import SwiftUI

/// A parent's home: the students they follow, each shown read-only at the level the student chose.
/// RootView shows it instead of the tabs when `SessionModel.showsParentHome`.
struct ParentHomeView: View {
    @Environment(SessionModel.self) private var session
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var students: [ParentStudent]?
    @State private var selectedID: String?
    @State private var error: APIError?
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Parent dashboard")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { toolbar }
                .forgeScreenBackground()
        }
        .task { await load() }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task {
                await load()
                await session.refreshParent()
            }
        }
        .confirmationDialog("Sign out of Forge?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await session.signOut() } }
        }
    }

    private var selected: ParentStudent? {
        students?.first { $0.id == selectedID } ?? students?.first
    }

    @ViewBuilder private var content: some View {
        if let students {
            if let selected {
                // The level is part of the identity: a student lowering it must not leave the old data on screen.
                ParentDashboardView(studentID: selected.id)
                    .id("\(selected.id)|\(selected.level)")
            } else if students.isEmpty {
                EmptyStateView(
                    systemImage: "person.2",
                    title: "No students yet",
                    message: "When your student invites you from Forge, open the link in the email to start following their applications.",
                    actionTitle: "Check again",
                    action: { Task { await load() } }
                )
            }
        } else if let error {
            ErrorStateView(error: error) { await load() }
        } else {
            LoadingView(label: "Loading…")
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        if let students, students.count > 1 {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Picker("Student", selection: Binding(get: { selected?.id ?? "" }, set: { selectedID = $0 })) {
                        ForEach(students) { Text($0.name).tag($0.id) }
                    }
                } label: {
                    Label("Students", systemImage: "person.2")
                }
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                if let email = session.user?.email {
                    Text(email)
                }
                Button("Start my own applications", systemImage: "graduationcap") {
                    session.parentWantsOwnWorkspace = true
                    session.showParentDashboard = false
                    Task { await store.loadIfNeeded() }
                }
                Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                    confirmSignOut = true
                }
            } label: {
                Label("Account", systemImage: "person.crop.circle")
            }
        }
    }

    private func load() async {
        do {
            let list = try await store.api.parentStudents()
            students = list
            if let selectedID, !list.contains(where: { $0.id == selectedID }) { self.selectedID = nil }
            error = nil
        } catch {
            if students == nil { self.error = APIError.wrap(error) }
        }
    }
}
