import SwiftUI

/// "Status" view: schools that need attention first, then one section per stage.
struct ApplicationsStatusList: View {
    let picker: ApplicationsModePicker
    @Binding var sheet: ApplicationsSheet?
    @Environment(WorkspaceStore.self) private var store

    var body: some View {
        let groups = ApplicationsOrdering.byStatus(store.applications)
        List {
            Section { picker }
            if let error = store.refreshError {
                ErrorBanner(message: error.message, retry: { Task { await store.refresh() } }, dismiss: { store.refreshError = nil })
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            Section { ApplicationsSummary(apps: store.applications) }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 0, leading: Theme.Spacing.md, bottom: 0, trailing: Theme.Spacing.md))
            ForEach(groups) { group in
                Section {
                    ForEach(group.apps) { app in
                        ApplicationListRow(app: app, expanded: group.isAttention)
                    }
                } header: {
                    ApplicationsSectionHeader(title: group.title, count: group.apps.count, tone: group.isAttention ? Theme.coral : nil)
                }
            }
            Section {
                NavigationLink(value: ApplicationsDestination.lettersAid) {
                    Label("Letters & financial aid", systemImage: "envelope.open")
                }
                Button { sheet = .importCollegeApps } label: {
                    Label("Bring schools from College Apps", systemImage: "square.and.arrow.down")
                }
                Button { sheet = .forwardEmails } label: {
                    Label("Forward a portal setup email", systemImage: "envelope.arrow.triangle.branch")
                }
            } header: {
                ApplicationsSectionHeader(title: "More", count: nil, tone: nil)
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .refreshable { await store.refresh() }
        .animation(.snappy, value: groups.map(\.id))
    }
}

/// Section title with a count, in the app's serif.
struct ApplicationsSectionHeader: View {
    let title: String
    let count: Int?
    let tone: Color?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.xs) {
            if let tone { Circle().fill(tone).frame(width: 7, height: 7).accessibilityHidden(true) }
            Text(title).font(.forgeDisplay(.title3)).foregroundStyle(Theme.ink)
            if let count {
                Text("\(count)").font(.forgeNumber(.subheadline)).foregroundStyle(Theme.muted)
            }
        }
        .textCase(nil)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// "3 working on · 2 waiting to hear · 1 admitted", as numbers across the top.
private struct ApplicationsSummary: View {
    let apps: [TrackedApplication]

    var body: some View {
        let counts = ApplicationsOrdering.stageCounts(apps)
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Theme.Spacing.lg) { cells(counts) }
            VStack(alignment: .leading, spacing: Theme.Spacing.xs) { cells(counts) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, Theme.Spacing.xxs)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func cells(_ counts: [(stage: AppStage, count: Int)]) -> some View {
        ForEach(counts, id: \.stage) { item in
            HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.xxs) {
                Text("\(item.count)").font(.forgeNumber(.title3, weight: .semibold)).foregroundStyle(item.stage.tone)
                Text(item.stage.label.lowercased()).font(.footnote).foregroundStyle(Theme.muted)
            }
        }
    }
}

#Preview {
    NavigationStack { ApplicationsStatusList(picker: ApplicationsModePicker(mode: .constant(.status)), sheet: .constant(nil)) }
        .environment(PortalCheckModel())
        .previewEnvironment()
}
