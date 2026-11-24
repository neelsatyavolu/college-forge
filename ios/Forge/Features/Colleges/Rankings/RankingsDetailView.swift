import SwiftUI

/// One school's place in the career ranking: each measure against the other schools, and the facts behind it.
struct RankingsDetailView: View {
    let row: RankingsRow
    let path: Bool
    @Environment(WorkspaceStore.self) private var store
    @Environment(RankingsModel.self) private var model

    var body: some View {
        List {
            Section { summary }
            Section("How it scores") {
                ForEach(row.measures) { measure in
                    RankingsMeasureRow(measure: measure, pillar: pillar(measure.key))
                }
            }
            Section("Behind the numbers") {
                fact("Scored on", row.counted)
                fact("Pay, 4 years out", RankingsFormat.money(row.pay4))
                fact("Top quarter, 10 years in", RankingsFormat.money(row.facts.topQuarter))
                fact("Bottom quarter, 10 years in", RankingsFormat.money(row.facts.bottomQuarter))
                fact("Reach the top 1%", RankingsFormat.percent(row.top1) + (row.top1System == nil ? "" : "*"))
                fact("Not working or in school", RankingsFormat.percent(row.facts.idle))
                fact("Graduation rate", RankingsFormat.percent(row.facts.grad, digits: 0))
                fact("Admit rate", RankingsFormat.percent(row.facts.admit, digits: 0))
                fact("Campus · dorms · food", [row.facts.campus, row.facts.dorms, row.facts.food].map { $0 ?? "—" }.joined(separator: " · "))
            }
            Section {
                fact("U.S. News", RankingsFormat.rank(row.usNews) + (row.usNewsLac ? " liberal arts" : ""))
                fact("Niche", RankingsFormat.rank(row.niche))
                fact("Forbes", RankingsFormat.rank(row.forbes))
            } header: {
                Text("Other rankings")
            } footer: {
                Text("Shown for comparison, not scored.")
            }
            if path, !row.switches.isEmpty {
                Section("Switching in after you enroll") {
                    ForEach(row.switches, id: \.name) { item in
                        fact(item.name, item.how)
                    }
                }
            }
            if let system = row.top1System {
                Section {
                    Text("* The top-1% figure covers the whole state system (\(system)), so it is shown but not scored.")
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(row.name)
        .navigationBarTitleDisplayMode(.inline)
        .forgeScreenBackground()
    }

    private var summary: some View {
        HStack(spacing: Theme.Spacing.md) {
            SchoolLogo(name: row.name, path: row.logo, config: store.config, size: 56)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: Theme.Spacing.xs) {
                    Text(row.rank).font(.forgeDisplay(.title, weight: .semibold)).foregroundStyle(Theme.ink)
                    if row.admitted { RankingsAdmittedBadge() }
                }
                Text(row.place).font(.subheadline).foregroundStyle(Theme.muted)
                if let range = row.range {
                    Text("\(range) if any one career measure is dropped").font(.caption).foregroundStyle(Theme.mutedSoft)
                }
                RankingsScoreBar(score: row.score)
            }
        }
        .padding(.vertical, Theme.Spacing.xxs)
    }

    private func pillar(_ key: String) -> RankingsPillar? {
        model.response?.pillars.first { $0.key == key }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        LabeledContent(label) {
            Text(value).font(.forgeNumber(.subheadline)).foregroundStyle(Theme.ink).multilineTextAlignment(.trailing)
        }
        .font(.subheadline)
    }
}

private struct RankingsMeasureRow: View {
    let measure: RankingsMeasure
    let pillar: RankingsPillar?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(pillar?.label ?? measure.key).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                Spacer()
                Text(measure.word).font(.subheadline.weight(.medium)).foregroundStyle(color)
            }
            if let percentile = measure.percentile {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.fill)
                        Capsule().fill(color).frame(width: geo.size.width * CGFloat(percentile) / 100)
                    }
                }
                .frame(height: 5)
                .accessibilityLabel("Better than about \(percentile)% of the schools here")
            }
            HStack {
                if let note = pillar?.note { Text(note) }
                Spacer(minLength: Theme.Spacing.sm)
                Text("\(measure.share)% of score").font(.forgeNumber(.caption)).fixedSize()
            }
            .font(.caption)
            .foregroundStyle(Theme.muted)
        }
        .padding(.vertical, 2)
    }

    private var color: Color {
        switch measure.word {
        case "Strong", "Good": Theme.accent
        case "Weak", "Very weak": Theme.coral
        default: Theme.body
        }
    }
}
