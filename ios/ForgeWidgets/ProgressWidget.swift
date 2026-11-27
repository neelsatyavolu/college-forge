import SwiftUI
import WidgetKit

/// How many applications are sent, as a ring.
struct ProgressWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ForgeProgress", provider: ForgeProvider()) { entry in
            ProgressWidgetView(entry: entry)
        }
        .configurationDisplayName("Applications Sent")
        .description("How many of your applications are submitted.")
        .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}

struct ProgressWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ForgeEntry

    private var tally: WidgetAgenda.Tally { entry.snapshot.map(WidgetAgenda.tally) ?? .init() }
    private var fraction: Double { tally.total == 0 ? 0 : Double(tally.submitted) / Double(tally.total) }

    var body: some View {
        content
            .forgeWidgetBackground()
            .widgetURL(WidgetLinks.applications)
    }

    @ViewBuilder private var content: some View {
        if family == .accessoryCircular {
            Gauge(value: fraction) {
                Text("Sent")
            } currentValueLabel: {
                Text("\(tally.submitted)/\(tally.total)").monospacedDigit()
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .widgetAccentable()
        } else if let message = WidgetGate.message(entry.snapshot) {
            message
        } else {
            VStack(alignment: .leading, spacing: 0) {
                WidgetEyebrow(text: "Applications")
                Spacer(minLength: 6)
                HStack(alignment: .center, spacing: 12) {
                    ProgressRing(
                        progress: fraction, lineWidth: 7,
                        tint: tally.submitted == tally.total ? Theme.success : Theme.accent,
                        label: "\(tally.submitted)/\(tally.total)", size: 64
                    )
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(tally.submitted)").font(.forgeNumber(.title2, weight: .bold)).foregroundStyle(Theme.ink)
                        Text("sent").font(.caption).foregroundStyle(Theme.muted)
                    }
                }
                Spacer(minLength: 6)
                Text(tally.working == 0 ? "All sent" : "\(tally.working) still to go")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(tally.working == 0 ? Theme.success : Theme.body)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

#Preview(as: .systemSmall) {
    ProgressWidget()
} timeline: {
    ForgeEntry(date: .now, snapshot: .sample)
}
