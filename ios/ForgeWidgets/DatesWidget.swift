import SwiftUI
import WidgetKit

/// The next few dates: deadlines, decision dates, follow-ups and the student's own dates.
struct DatesWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ForgeDates", provider: ForgeProvider()) { entry in
            DatesView(entry: entry)
        }
        .configurationDisplayName("Coming Up")
        .description("Your next deadlines, decision dates and follow-ups, by date.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct DatesView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ForgeEntry

    private var items: [WidgetItem] {
        entry.snapshot.map { WidgetAgenda.upcomingDates($0, now: entry.date) } ?? []
    }

    var body: some View {
        content
            .forgeWidgetBackground()
            .widgetURL(WidgetLinks.applications)
    }

    @ViewBuilder private var content: some View {
        if let message = WidgetGate.message(entry.snapshot) {
            message
        } else if items.isEmpty {
            WidgetMessage(symbol: "calendar", title: "No dates ahead", detail: "Deadlines and decision dates show up here.")
        } else {
            let shown = Array(items.prefix(family == .systemLarge ? 8 : 3))
            VStack(alignment: .leading, spacing: 7) {
                WidgetEyebrow(text: "Coming up", trailing: items.count > shown.count ? "\(items.count - shown.count) more" : nil)
                ForEach(shown) { item in
                    Link(destination: WidgetLinks.open(item)) { row(item) }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private func row(_ item: WidgetItem) -> some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(spacing: -1) {
                Text(month(item.date)).font(.system(size: 9, weight: .semibold)).foregroundStyle(item.tint)
                Text(day(item.date)).font(.forgeNumber(.subheadline, weight: .bold)).foregroundStyle(Theme.ink)
            }
            .frame(width: 30)
            VStack(alignment: .leading, spacing: 0) {
                Text(item.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                Text(rowDetail(item)).font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
            }
            Spacer(minLength: 4)
            Text(WidgetAgenda.when(item.date, now: entry.date))
                .font(.caption2.weight(.medium))
                .foregroundStyle(item.tier <= 1 ? item.tint : Theme.mutedSoft)
                .lineLimit(1)
        }
    }

    private func rowDetail(_ item: WidgetItem) -> String {
        switch item.kind {
        case .decisionDate: "Decision · " + item.detail
        default: item.detail
        }
    }

    private func month(_ iso: String) -> String {
        ForgeDates.day(iso)?.formatted(.dateTime.month(.abbreviated)).uppercased() ?? ""
    }

    private func day(_ iso: String) -> String {
        ForgeDates.day(iso)?.formatted(.dateTime.day()) ?? ""
    }
}

#Preview(as: .systemMedium) {
    DatesWidget()
} timeline: {
    ForgeEntry(date: .now, snapshot: .sample)
}
