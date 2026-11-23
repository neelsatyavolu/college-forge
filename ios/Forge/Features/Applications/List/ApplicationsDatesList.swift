import SwiftUI

/// "Dates" view: deadlines, decision dates and the student's own dates, soonest first, by month.
struct ApplicationsDatesList: View {
    let picker: ApplicationsModePicker
    @Environment(WorkspaceStore.self) private var store

    var body: some View {
        let months = ApplicationsAgenda.months(apps: store.applications, criticalDates: store.workspace.criticalDates)
        List {
            Section { picker }
            if months.isEmpty {
                ContentUnavailableView(
                    "No upcoming dates",
                    systemImage: "calendar",
                    description: Text("Add deadlines to your schools, or wait for portals to post decision dates.")
                )
                .listRowBackground(Color.clear)
            }
            ForEach(months) { month in
                Section {
                    ForEach(month.items) { item in
                        if let id = item.applicationID {
                            NavigationLink(value: ApplicationRoute(id: id)) { AgendaRow(item: item) }
                        } else {
                            AgendaRow(item: item)
                        }
                    }
                } header: {
                    ApplicationsSectionHeader(title: month.title, count: nil, tone: nil)
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .refreshable { await store.refresh() }
    }
}

private struct AgendaRow: View {
    let item: AgendaItem

    var body: some View {
        let date = ForgeDates.day(item.date) ?? .now
        let days = ForgeDates.daysUntil(item.date) ?? 0
        HStack(spacing: Theme.Spacing.sm) {
            VStack(spacing: 0) {
                Text(date.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(days <= 7 ? Theme.coral : Theme.muted)
                Text(date.formatted(.dateTime.day()))
                    .font(.forgeNumber(.title2, weight: .semibold))
                    .foregroundStyle(Theme.ink)
            }
            .frame(minWidth: 44)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                Text(subtitle(days: days)).font(.subheadline).foregroundStyle(Theme.muted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.title), \(ForgeDates.short(item.date)). \(subtitle(days: days))")
    }

    private func subtitle(days: Int) -> String {
        item.estimated ? item.detail : "\(item.detail) · \(ForgeDates.relative(item.date))"
    }
}

#Preview {
    NavigationStack { ApplicationsDatesList(picker: ApplicationsModePicker(mode: .constant(.status))) }.previewEnvironment()
}
