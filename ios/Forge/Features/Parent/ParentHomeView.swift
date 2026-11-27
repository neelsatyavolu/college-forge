import SwiftUI

/// A parent's or counselor's home: the students they follow, each at the level the student chose. One student
/// opens straight away; more open on a roster sorted by who needs a look first, with what's due across all of
/// them in the next two weeks. RootView shows it instead of the tabs when `SessionModel.showsParentHome`.
struct ParentHomeView: View {
    @Environment(SessionModel.self) private var session
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var students: [ParentStudent]?
    @State private var error: APIError?
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(title)
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

    private var title: String {
        let roles = Set((students ?? []).map(\.followerRole))
        if roles == [.counselor] || (roles.isEmpty && session.parent.counselor) { return "Counselor dashboard" }
        return roles.count > 1 ? "Your students" : "Parent dashboard"
    }

    @ViewBuilder private var content: some View {
        if let students {
            if students.count == 1, let only = students.first {
                // The level is part of the identity: a student lowering it must not leave the old data on screen.
                ParentDashboardView(studentID: only.id)
                    .id("\(only.id)|\(only.level)")
            } else if students.count > 1 {
                ParentRosterView(students: students)
                    .refreshable { await load() }
            } else {
                EmptyStateView(
                    systemImage: "person.2",
                    title: "No students yet",
                    message: "When a student invites you from Forge, open the link in the email to start following their applications.",
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
            // A writing coach's essays view is web-only for now.
            students = try await store.api.parentStudents().filter { $0.role != "coach" }
            error = nil
        } catch {
            if students == nil { self.error = APIError.wrap(error) }
        }
    }
}

/// Every student at a glance (lib/follower-summary.ts): what's due across all of them soon, then each student,
/// sorted by who needs a look first. Tapping one opens their dashboard.
private struct ParentRosterView: View {
    let students: [ParentStudent]
    @State private var query = ""

    private var sorted: [ParentStudent] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return students
            .filter { q.isEmpty || $0.name.lowercased().contains(q) }
            .sorted {
                if $0.summary.attention != $1.summary.attention { return $0.summary.attention > $1.summary.attention }
                let a = $0.summary.next?.date ?? "9999", b = $1.summary.next?.date ?? "9999"
                return a != b ? a < b : $0.name < $1.name
            }
    }

    private var upcoming: [(id: String, who: String, item: DatedItem)] {
        students.flatMap { s in s.summary.upcoming.map { (id: s.id, who: firstName(s.name), item: $0) } }
            .sorted { $0.item.date < $1.item.date }
    }

    var body: some View {
        List {
            if !upcoming.isEmpty {
                Section("Next two weeks") {
                    ForEach(Array(upcoming.prefix(12).enumerated()), id: \.offset) { _, row in
                        NavigationLink(value: row.id) {
                            HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(row.who).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                                    Text(row.item.title).font(.subheadline).foregroundStyle(Theme.muted)
                                }
                                Spacer()
                                Text(relative(row.item.date)).font(.subheadline.monospacedDigit()).foregroundStyle(Theme.body)
                            }
                        }
                    }
                }
            }
            Section("Students") {
                ForEach(sorted) { student in
                    NavigationLink(value: student.id) { ParentRosterRow(student: student, nextIn: student.summary.next.map { relative($0.date) }) }
                }
                if sorted.isEmpty { Text("No student matches “\(query)”.").foregroundStyle(Theme.muted) }
            }
        }
        .listStyle(.insetGrouped)
        .forgeScreenBackground()
        .searchable(text: $query, prompt: "Find a student")
        .navigationDestination(for: String.self) { id in
            if let student = students.first(where: { $0.id == id }) {
                ParentDashboardView(studentID: id)
                    .id("\(id)|\(student.level)")
                    .navigationTitle(firstName(student.name))
                    .navigationBarTitleDisplayMode(.inline)
            }
        }
    }

    private func firstName(_ name: String) -> String { name.split(separator: " ").first.map(String.init) ?? name }

    /// "today", "tomorrow", "in 5d" or "3d late" for a yyyy-mm-dd date.
    private func relative(_ date: String) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        guard let day = f.date(from: date) else { return date }
        let n = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: .now), to: day).day ?? 0
        switch n {
        case 0: return "today"
        case 1: return "tomorrow"
        case ..<0: return "\(-n)d late"
        default: return "in \(n)d"
        }
    }
}

private struct ParentRosterRow: View {
    let student: ParentStudent
    let nextIn: String?

    var body: some View {
        let m = student.summary
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(student.name).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                Spacer()
                Text("\(m.submitted)/\(m.applications) sent").font(.subheadline.monospacedDigit()).foregroundStyle(Theme.muted)
            }
            Text([student.cycle, student.followerRole.label, student.levelLabel].filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.subheadline).foregroundStyle(Theme.muted)
            if let next = m.next, let nextIn {
                Text("\(nextIn) · \(next.title)").font(.subheadline).foregroundStyle(Theme.body).lineLimit(1)
            }
            if m.overdue + m.dueSoon + m.flags > 0 {
                HStack(spacing: Theme.Spacing.xs) {
                    if m.overdue > 0 { Badge(text: "\(m.overdue) late", tone: Theme.danger) }
                    if m.dueSoon > 0 { Badge(text: "\(m.dueSoon) due soon", tone: Theme.amber) }
                    if m.flags > 0 { Badge(text: m.flags == 1 ? "1 flag" : "\(m.flags) flags", tone: Theme.coral) }
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}
