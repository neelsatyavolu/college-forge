import SwiftUI
import WidgetKit

/// Days until the next application deadline.
struct CountdownWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ForgeCountdown", provider: ForgeProvider()) { entry in
            CountdownView(entry: entry)
        }
        .configurationDisplayName("Next Deadline")
        .description("Counts down the days to your next application deadline.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular])
    }
}

struct CountdownView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ForgeEntry

    private var next: WidgetItem? {
        entry.snapshot.flatMap { WidgetAgenda.nextDeadline($0, now: entry.date) }
    }

    private var days: Int { next.flatMap { ForgeDates.daysUntil($0.date, now: entry.date) } ?? 0 }

    var body: some View {
        content
            .forgeWidgetBackground()
            .widgetURL(WidgetLinks.open(next))
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryCircular: circular
        case .accessoryRectangular: rectangular
        default: small
        }
    }

    @ViewBuilder private var small: some View {
        if let message = WidgetGate.message(entry.snapshot) {
            message
        } else if let next {
            VStack(alignment: .leading, spacing: 0) {
                WidgetEyebrow(text: "Next deadline")
                Spacer(minLength: 4)
                if days == 0 {
                    Text("Today")
                        .font(.forgeDisplay(.largeTitle, weight: .bold))
                        .foregroundStyle(Theme.coral)
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text("\(days)")
                            .font(.system(size: 46, weight: .bold).monospacedDigit())
                            .foregroundStyle(days <= 3 ? Theme.coral : Theme.ink)
                            .minimumScaleFactor(0.6)
                        Text(days == 1 ? "day" : "days")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Theme.muted)
                    }
                }
                Spacer(minLength: 4)
                Text(next.title)
                    .font(.forgeDisplay(.subheadline))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                Text("Due " + ForgeDates.short(next.date, now: entry.date))
                    .font(.caption2)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            WidgetMessage(symbol: "checkmark.seal", title: "No deadlines ahead", detail: "Every application with a deadline is sent.")
        }
    }

    @ViewBuilder private var circular: some View {
        if next != nil {
            VStack(spacing: -2) {
                Text(days == 0 ? "!" : "\(days)")
                    .font(.system(.title, design: .rounded, weight: .bold).monospacedDigit())
                    .minimumScaleFactor(0.5)
                Text(days == 0 ? "today" : days == 1 ? "day" : "days")
                    .font(.caption2)
            }
            .widgetAccentable()
        } else {
            Image(systemName: "checkmark").font(.title2.weight(.semibold))
        }
    }

    @ViewBuilder private var rectangular: some View {
        if let next {
            VStack(alignment: .leading, spacing: 0) {
                Text(next.headline(now: entry.date)).font(.caption.weight(.semibold)).widgetAccentable()
                Text(next.title).font(.headline).lineLimit(1)
                Text(ForgeDates.short(next.date, now: entry.date)).font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Text(entry.snapshot == nil ? "Sign in to Forge" : "No deadlines ahead").font(.caption)
        }
    }
}

#Preview(as: .systemSmall) {
    CountdownWidget()
} timeline: {
    ForgeEntry(date: .now, snapshot: .sample)
}
