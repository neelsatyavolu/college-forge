import SwiftUI
import WidgetKit

/// The most urgent thing: a posted decision first, then whatever is due soonest (see `WidgetAgenda.upNext`).
struct UpNextWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ForgeUpNext", provider: ForgeProvider()) { entry in
            UpNextView(entry: entry)
        }
        .configurationDisplayName("Up Next")
        .description("A posted decision, or the most urgent deadline, follow-up or missing item.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline])
    }
}

struct UpNextView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ForgeEntry

    private var items: [WidgetItem] {
        entry.snapshot.map { WidgetAgenda.upNext($0, now: entry.date) } ?? []
    }

    var body: some View {
        content.forgeWidgetBackground()
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryInline: inline
        case .accessoryRectangular: rectangular
        default:
            if let message = WidgetGate.message(entry.snapshot) {
                message.widgetURL(WidgetLinks.applications)
            } else if let first = items.first {
                switch family {
                case .systemSmall: small(first)
                case .systemLarge: list(first, more: 6)
                default: list(first, more: 1)
                }
            } else {
                WidgetMessage(symbol: "checkmark.circle", title: "Nothing due", detail: "No deadlines, follow-ups or missing items ahead.")
                    .widgetURL(WidgetLinks.applications)
            }
        }
    }

    private func small(_ first: WidgetItem) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            WidgetEyebrow(text: "Up next")
            Spacer(minLength: 6)
            WidgetLeadItem(item: first, now: entry.date, titleLines: 3)
            if items.count > 1 {
                Spacer(minLength: 4)
                Text("\(items.count - 1) more")
                    .font(.caption2)
                    .foregroundStyle(Theme.mutedSoft)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(WidgetLinks.open(first))
    }

    private func list(_ first: WidgetItem, more: Int) -> some View {
        let rest = Array(items.dropFirst().prefix(more))
        return VStack(alignment: .leading, spacing: 8) {
            WidgetEyebrow(text: "Up next", trailing: items.count > 1 ? "\(items.count) things" : nil)
            Link(destination: WidgetLinks.open(first)) {
                WidgetLeadItem(item: first, now: entry.date, titleLines: 1)
            }
            if !rest.isEmpty {
                Divider().overlay(Theme.hairline)
                ForEach(rest) { item in
                    Link(destination: WidgetLinks.open(item)) {
                        WidgetItemRow(item: item, now: entry.date)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(WidgetLinks.applications)
    }

    @ViewBuilder private var rectangular: some View {
        if let first = items.first {
            VStack(alignment: .leading, spacing: 0) {
                Label(first.headline(now: entry.date), systemImage: first.symbol)
                    .font(.caption.weight(.semibold))
                    .widgetAccentable()
                Text(first.title).font(.headline).lineLimit(1)
                Text(first.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(WidgetLinks.open(first))
        } else {
            VStack(alignment: .leading) {
                Text("Forge").font(.headline).widgetAccentable()
                Text(entry.snapshot == nil ? "Sign in to see your applications" : "Nothing due").font(.caption)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder private var inline: some View {
        if let first = items.first {
            Label("\(first.kind == .followUp ? first.detail : first.title): \(first.headline(now: entry.date).lowercased())", systemImage: first.symbol)
        } else {
            Label(entry.snapshot == nil ? "Forge" : "Forge: nothing due", systemImage: "checkmark.circle")
        }
    }
}

#Preview(as: .systemMedium) {
    UpNextWidget()
} timeline: {
    ForgeEntry(date: .now, snapshot: .sample)
}

#Preview(as: .systemSmall) {
    UpNextWidget()
} timeline: {
    ForgeEntry(date: .now, snapshot: .sample)
    ForgeEntry(date: .now, snapshot: nil)
}
