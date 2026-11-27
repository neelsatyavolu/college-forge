import SwiftUI
import WidgetKit

/// Decisions so far: posted and unopened first, then admitted, waiting and not admitted. Never says what
/// an unopened decision is.
struct DecisionsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ForgeDecisions", provider: ForgeProvider()) { entry in
            DecisionsView(entry: entry)
        }
        .configurationDisplayName("Decisions")
        .description("Shows when a decision is posted, and how your schools stand.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular])
    }
}

struct DecisionsView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ForgeEntry

    private var tally: WidgetAgenda.Tally { entry.snapshot.map(WidgetAgenda.tally) ?? .init() }
    private var posted: [WidgetApp] { entry.snapshot?.apps.filter(\.decisionPosted) ?? [] }

    /// The soonest decision date still ahead.
    private var nextExpected: WidgetItem? {
        entry.snapshot.flatMap { WidgetAgenda.upcomingDates($0, now: entry.date).first { $0.kind == .decisionDate } }
    }

    var body: some View {
        content
            .forgeWidgetBackground()
            .widgetURL(posted.count == 1 ? WidgetLinks.application(posted[0].id) : WidgetLinks.applications)
    }

    @ViewBuilder private var content: some View {
        if family == .accessoryCircular {
            circular
        } else if let message = WidgetGate.message(entry.snapshot) {
            message
        } else if family == .systemMedium {
            HStack(spacing: 16) {
                headline.frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 6) {
                    counts
                    Spacer(minLength: 0)
                    if let nextExpected {
                        Text("Next: \(nextExpected.title), \(WidgetAgenda.when(nextExpected.date, now: entry.date))")
                            .font(.caption2)
                            .foregroundStyle(Theme.muted)
                            .lineLimit(2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            headline
        }
    }

    /// The big number: decisions posted, or admissions when none are waiting to be opened.
    private var headline: some View {
        VStack(alignment: .leading, spacing: 0) {
            WidgetEyebrow(text: "Decisions", tint: posted.isEmpty ? Theme.muted : Theme.coral)
            Spacer(minLength: 4)
            if posted.isEmpty {
                bigNumber(tally.admitted, tally.admitted == 1 ? "admission" : "admissions", tint: tally.admitted > 0 ? Theme.success : Theme.ink)
                Spacer(minLength: 4)
                Text(tally.waiting > 0 ? "Waiting on \(tally.waiting) \(tally.waiting == 1 ? "school" : "schools")" : "\(tally.submitted) of \(tally.total) sent")
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            } else {
                bigNumber(posted.count, posted.count == 1 ? "decision posted" : "decisions posted", tint: Theme.coral)
                Spacer(minLength: 4)
                Text(posted.map(\.name).joined(separator: ", "))
                    .font(.forgeDisplay(.caption))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                Text("Open Forge to see it")
                    .font(.caption2)
                    .foregroundStyle(Theme.muted)
            }
        }
        .frame(maxHeight: .infinity, alignment: .topLeading)
    }

    private func bigNumber(_ n: Int, _ label: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("\(n)")
                .font(.system(size: 42, weight: .bold).monospacedDigit())
                .foregroundStyle(tint)
            Text(label)
                .font(.caption.weight(.medium))
                .foregroundStyle(Theme.muted)
        }
    }

    private var counts: some View {
        VStack(alignment: .leading, spacing: 4) {
            countRow("Admitted", tally.admitted, Theme.success)
            countRow("Waiting", tally.waiting, Theme.amber)
            countRow("Not admitted", tally.denied, Theme.muted)
            countRow("Still working", tally.working, Theme.accent)
        }
    }

    private func countRow(_ label: String, _ n: Int, _ tint: Color) -> some View {
        HStack {
            Circle().fill(tint).frame(width: 6, height: 6)
            Text(label).font(.caption).foregroundStyle(Theme.body)
            Spacer()
            Text("\(n)").font(.forgeNumber(.caption, weight: .semibold)).foregroundStyle(Theme.ink)
        }
    }

    @ViewBuilder private var circular: some View {
        if !posted.isEmpty {
            VStack(spacing: -1) {
                Image(systemName: "envelope.badge.fill").font(.body)
                Text("\(posted.count)").font(.system(.title3, design: .rounded, weight: .bold))
            }
            .widgetAccentable()
        } else {
            VStack(spacing: -1) {
                Text("\(tally.admitted)").font(.system(.title2, design: .rounded, weight: .bold)).widgetAccentable()
                Text("in").font(.caption2)
            }
        }
    }
}

#Preview(as: .systemMedium) {
    DecisionsWidget()
} timeline: {
    ForgeEntry(date: .now, snapshot: .sample)
}
