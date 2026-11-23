import SwiftUI

/// The top of the Profile tab: readiness, what's due, flags, and where each application stands.
struct ProgressOverviewSections: View {
    @Environment(WorkspaceStore.self) private var store

    var body: some View {
        let summary = ProgressSummary(tracker: store.tracker)
        let readiness = ProfileReadiness(workspace: store.workspace)
        let deadlines = UpcomingDeadlines.build(workspace: store.workspace, tracker: store.tracker)

        Section {
            NavigationLink(value: ProfileRoute.readiness) {
                ProgressHeader(readiness: readiness, summary: summary, flags: store.tracker.flags.count)
            }
        }
        UpcomingDeadlinesSection(deadlines: deadlines)
        FlagsSection(flags: store.tracker.flags)
        if summary.total > 0 {
            ApplicationGroupsSections(summary: summary)
        }
    }
}

/// Ring plus one line for applications.
private struct ProgressHeader: View {
    let readiness: ProfileReadiness
    let summary: ProgressSummary
    let flags: Int

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            ProgressRing(progress: readiness.progress, lineWidth: 6, label: "\(readiness.doneCount)/\(readiness.items.count)", size: 60)
            VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                Eyebrow(text: "Readiness")
                Text(readiness.nextItem.map { "Next: \($0.title)" } ?? "Everything's on file")
                    .font(.forgeDisplay(.title3))
                    .foregroundStyle(Theme.ink)
                Text(summary.total > 0 ? summary.headline(flags: flags) : "Add the schools you're applying to and they'll show up here.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
        }
        .padding(.vertical, Theme.Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}

/// The next few dated items, with a link to the full list.
private struct UpcomingDeadlinesSection: View {
    let deadlines: [UpcomingDeadline]

    var body: some View {
        Section {
            if deadlines.isEmpty {
                Text("No upcoming deadlines.")
                    .foregroundStyle(Theme.muted)
            } else {
                ForEach(deadlines.prefix(4)) { DeadlineRow(item: $0) }
            }
        } header: {
            HStack {
                Text("Coming up")
                Spacer()
                if deadlines.count > 4 {
                    NavigationLink("See all \(deadlines.count)", value: ProfileRoute.deadlines)
                        .font(.subheadline)
                        .textCase(nil)
                }
            }
        }
    }
}

/// Open flags. Swipe to resolve; add one from the button.
private struct FlagsSection: View {
    @Environment(WorkspaceStore.self) private var store
    let flags: [TrackerFlag]
    @State private var adding = false
    @State private var text = ""
    @State private var error: APIError?

    var body: some View {
        Section {
            ForEach(flags) { flag in
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(flag.text).foregroundStyle(Theme.ink)
                        if !flag.scope.isEmpty {
                            Text(flag.scope).font(.footnote).foregroundStyle(Theme.muted)
                        }
                    }
                } icon: {
                    Image(systemName: "flag.fill").foregroundStyle(Theme.coral)
                }
                .swipeActions {
                    Button("Resolve", systemImage: "checkmark") { resolve(flag) }.tint(Theme.success)
                }
                .contextMenu {
                    Button("Resolve", systemImage: "checkmark") { resolve(flag) }
                }
            }
            Button("Flag something", systemImage: "flag") { adding = true }
        } header: {
            if !flags.isEmpty { Text("Flags") }
        }
        .alert("Flag something that needs attention", isPresented: $adding) {
            TextField("Counselor letter not sent", text: $text)
            Button("Cancel", role: .cancel) { text = "" }
            Button("Flag it") { add() }
        }
        .errorAlert($error)
    }

    private func resolve(_ flag: TrackerFlag) {
        Task {
            do { try await store.resolveFlag(flag.id); Haptics.success() }
            catch { self.error = APIError.wrap(error); Haptics.error() }
        }
    }

    private func add() {
        let value = text
        text = ""
        Task {
            do { try await store.addFlag(value); Haptics.success() }
            catch { self.error = APIError.wrap(error); Haptics.error() }
        }
    }
}
