import SwiftUI

/// Activities in Common App order. Drag to reorder, swipe to remove, tap to edit.
struct ActivitiesView: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var editing: ProfileActivityEditTarget?
    @State private var error: APIError?

    var body: some View {
        let activities = store.workspace.profile.activities
        let full = activities.count >= ProfileRules.maxActivities
        List {
            Section {
                ForEach(Array(activities.enumerated()), id: \.offset) { index, activity in
                    Button { editing = ProfileActivityEditTarget(index: index) } label: {
                        ActivityRow(rank: index + 1, activity: activity)
                    }
                    .tint(Theme.ink)
                }
                .onMove { from, to in
                    var next = activities
                    next.move(fromOffsets: from, toOffset: to)
                    save(next)
                }
                .onDelete { offsets in
                    var next = activities
                    next.remove(atOffsets: offsets)
                    save(next)
                }
            } header: {
                if !activities.isEmpty { Text("\(activities.count) of \(ProfileRules.maxActivities) · Common App order") }
            } footer: {
                if !activities.isEmpty { Text("Start with what matters most to you. Tap Edit to change the order.") }
            }
        }
        .overlay {
            if activities.isEmpty {
                EmptyStateView(systemImage: "figure.run", title: "No activities yet",
                               message: "Add clubs, sports, jobs, research or family responsibilities. Up to \(ProfileRules.maxActivities).",
                               actionTitle: "Add an activity") { editing = ProfileActivityEditTarget(index: nil) }
            }
        }
        .navigationTitle("Activities")
        .navigationBarTitleDisplayMode(.inline)
        .forgeScreenBackground()
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add activity", systemImage: "plus") { editing = ProfileActivityEditTarget(index: nil) }
                    .disabled(full)
            }
            if activities.count > 1 {
                ToolbarItem(placement: .topBarLeading) { EditButton() }
            }
        }
        .sheet(item: $editing) { target in
            let initial = target.index.flatMap { activities.indices.contains($0) ? activities[$0] : nil }
            ActivityEditorSheet(initial: initial ?? Activity(), number: (target.index ?? activities.count) + 1) { activity in
                var next = store.workspace.profile.activities
                if let i = target.index, next.indices.contains(i) { next[i] = activity } else { next.append(activity) }
                try await store.saveActivities(next)
            }
        }
        .errorAlert($error, title: "Couldn't save")
    }

    private func save(_ next: [Activity]) {
        Task {
            do { try await store.saveActivities(next) }
            catch { self.error = APIError.wrap(error); Haptics.error() }
        }
    }
}

struct ProfileActivityEditTarget: Identifiable {
    let index: Int?
    var id: Int { index ?? -1 }
}

private struct ActivityRow: View {
    let rank: Int
    let activity: Activity

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
            Text("\(rank)")
                .font(.forgeNumber(.footnote, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .frame(minWidth: 26, minHeight: 26)
                .background(Theme.fill, in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(activity.name).font(.forgeDisplay(.headline)).foregroundStyle(Theme.ink)
                if !meta.isEmpty {
                    Text(meta).font(.footnote).foregroundStyle(Theme.muted)
                }
                if let desc = activity.desc, !desc.isEmpty {
                    Text(desc).font(.subheadline).foregroundStyle(Theme.body).lineLimit(3)
                }
                badges
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private var meta: String {
        let hours = (activity.hpw ?? "").profileTrimmed
        let weeks = (activity.wpy ?? "").profileTrimmed
        let time = [hours.isEmpty ? "" : "\(hours) hr/wk", weeks.isEmpty ? "" : "\(weeks) wk/yr"]
        return ([activity.type, activity.role ?? "", activity.years ?? ""] + time)
            .filter { !$0.profileTrimmed.isEmpty }
            .joined(separator: " · ")
    }

    @ViewBuilder private var badges: some View {
        let over = (activity.desc ?? "").count > ProfileRules.descriptionLimit
        if activity.college == true || over {
            HStack(spacing: Theme.Spacing.xs) {
                if activity.college == true { Badge(text: "Continue in college", tone: Theme.teal) }
                if over { Badge(text: "Over \(ProfileRules.descriptionLimit) chars", tone: Theme.coral) }
            }
        }
    }
}
