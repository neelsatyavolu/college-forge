import SwiftUI

/// One dated item: date column, title, what it is.
struct DeadlineRow: View {
    @Environment(Router.self) private var router
    let item: UpcomingDeadline
    /// Wide enough for "Jan 7, 2027", so every title starts at the same edge.
    @ScaledMetric(relativeTo: .subheadline) private var dateWidth: CGFloat = 92

    var body: some View {
        if let id = item.applicationID {
            Button { router.openApplication(id: id) } label: { content }
                .tint(Theme.ink)
        } else {
            content
        }
    }

    private var content: some View {
        HStack(alignment: .center, spacing: Theme.Spacing.sm) {
            VStack(alignment: .leading, spacing: 0) {
                Text(ForgeDates.short(item.date))
                    .font(.forgeNumber(.subheadline, weight: .semibold))
                    .foregroundStyle(isSoon ? Theme.coral : Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(ForgeDates.relative(item.date))
                    .font(.caption2)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
            .frame(width: dateWidth, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).foregroundStyle(Theme.ink)
                if !item.detail.isEmpty {
                    Label(item.detail, systemImage: item.systemImage)
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                        .labelStyle(.titleAndIcon)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }

    private var isSoon: Bool {
        (ForgeDates.daysUntil(item.date) ?? 99) <= 7
    }
}

/// Every upcoming date, grouped by month.
struct DeadlinesView: View {
    @Environment(WorkspaceStore.self) private var store

    var body: some View {
        let items = UpcomingDeadlines.build(workspace: store.workspace, tracker: store.tracker)
        List {
            ForEach(Self.months(items), id: \.title) { month in
                Section(month.title) {
                    ForEach(month.items) { DeadlineRow(item: $0) }
                }
            }
        }
        .overlay {
            if items.isEmpty {
                EmptyStateView(systemImage: "calendar", title: "Nothing coming up",
                               message: "Deadlines from your schools, letters and scholarships show up here.")
            }
        }
        .navigationTitle("Coming up")
        .navigationBarTitleDisplayMode(.inline)
        .forgeScreenBackground()
        .refreshable { await store.refresh() }
    }

    /// Groups sorted items by "November 2026".
    static func months(_ items: [UpcomingDeadline]) -> [(title: String, items: [UpcomingDeadline])] {
        var out: [(title: String, items: [UpcomingDeadline])] = []
        for item in items {
            let title = ForgeDates.day(item.date)?.formatted(.dateTime.month(.wide).year()) ?? ""
            if out.last?.title == title { out[out.count - 1].items.append(item) }
            else { out.append((title, [item])) }
        }
        return out
    }
}

/// The readiness checklist with links to each editor.
struct ReadinessView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(Router.self) private var router

    var body: some View {
        let readiness = ProfileReadiness(workspace: store.workspace)
        List {
            Section {
                HStack(spacing: Theme.Spacing.md) {
                    ProgressRing(progress: readiness.progress, lineWidth: 8, label: "\(Int((readiness.progress * 100).rounded()))%", size: 72)
                    Text("\(readiness.doneCount) of \(readiness.items.count) parts of your application are on file.")
                        .font(.forgeDisplay(.title3))
                        .foregroundStyle(Theme.ink)
                }
                .padding(.vertical, Theme.Spacing.xs)
            }
            Section {
                ForEach(readiness.items) { item in
                    Button { open(item.target) } label: { ReadinessRow(item: item) }
                        .tint(Theme.ink)
                }
            } footer: {
                Text("A checklist of what's filled in, not a prediction of any decision.")
            }
        }
        .navigationTitle("Readiness")
        .navigationBarTitleDisplayMode(.inline)
        .forgeScreenBackground()
    }

    private func open(_ target: ProfileReadinessTarget) {
        switch target {
        case .route(let route): router.profilePath.append(route)
        case .tab(let tab): router.selectedTab = tab
        }
    }
}

private struct ReadinessRow: View {
    let item: ProfileReadinessItem

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Image(systemName: item.isDone ? "checkmark.circle.fill" : "circle")
                .font(.title3)
                .foregroundStyle(item.isDone ? Theme.success : Theme.mutedSoft)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).foregroundStyle(Theme.ink)
                Text(item.detail).font(.footnote).foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.mutedSoft)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(item.isDone ? "Done" : "To do")
    }
}
