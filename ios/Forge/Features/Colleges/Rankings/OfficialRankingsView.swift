import SwiftUI

/// The published U.S. News, liberal arts, Forbes and Niche lists, in the publishers' own order.
struct OfficialRankingsView: View {
    enum LoadState {
        case loading, loaded(OfficialRankings), failed(APIError)
    }

    @Environment(WorkspaceStore.self) private var store
    @AppStorage("forge.officialRankings.list") private var list: OfficialRankingList = .usn
    @State private var state = LoadState.loading

    var body: some View {
        content
            .navigationTitle("Official rankings")
            .navigationBarTitleDisplayMode(.inline)
            .forgeScreenBackground()
            .task { if case .loading = state { await load() } }
    }

    @ViewBuilder private var content: some View {
        switch state {
        case .loading:
            LoadingView(label: "Loading the rankings…")
        case .failed(let error):
            ErrorStateView(error: error) { await load() }
        case .loaded(let data):
            rows(data)
        }
    }

    private func load() async {
        do {
            state = .loaded(try await store.api.officialRankings())
        } catch {
            let apiError = APIError.wrap(error)
            if apiError != .cancelled { state = .failed(apiError) }
        }
    }

    private func rows(_ data: OfficialRankings) -> some View {
        let rows = data.lists[list.rawValue] ?? []
        return List {
            Section {
                Picker("List", selection: $list) {
                    ForEach(OfficialRankingList.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
                .sensoryFeedback(.selection, trigger: list)
            }
            .listSectionSpacing(Theme.Spacing.xs)

            Section {
                ForEach(rows, id: \.self) { row in
                    NavigationLink(value: OfficialRankingRoute(row: row, list: list.rawValue)) {
                        OfficialRankingRowView(row: row, config: store.config)
                    }
                }
            } header: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(list.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                    Text(sourceLine(data, rows: rows.count)).foregroundStyle(Theme.muted)
                }
                .font(.footnote)
                .textCase(nil)
                .padding(.bottom, Theme.Spacing.xxs)
            } footer: {
                Text("Ranks are copied from each publisher. Admit rate and SAT come from U.S. News and the College Scorecard where we have them, otherwise Forbes; setting from U.S. News; cost, salary and size from Forbes.")
                    .padding(.top, Theme.Spacing.xs)
            }
        }
        .listStyle(.insetGrouped)
        .contentMargins(.top, Theme.Spacing.xxs, for: .scrollContent)
    }

    private func sourceLine(_ data: OfficialRankings, rows: Int) -> String {
        var line = data.edition(for: list).map { "\($0) · " } ?? ""
        line += "top \(list.top)"
        if rows > list.top { line += " (\(rows) with ties)" }
        return line
    }
}

private struct OfficialRankingRowView: View {
    let row: OfficialRankingRow
    let config: AppConfig

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Text("\(row.rank)")
                .font(.forgeNumber(.headline, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .frame(width: 40)
            SchoolLogo(name: row.name, path: row.logo, config: config, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.name).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                if !row.place.isEmpty { Text(row.place).font(.caption).foregroundStyle(Theme.muted) }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// One school on an official list: its facts and where it lands on the other lists.
struct OfficialRankingDetailView: View {
    let row: OfficialRankingRow
    let list: String
    @Environment(WorkspaceStore.self) private var store

    var body: some View {
        List {
            Section {
                HStack(spacing: Theme.Spacing.md) {
                    SchoolLogo(name: row.name, path: row.logo, config: store.config, size: 56)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("#\(row.rank)").font(.forgeDisplay(.title, weight: .semibold)).foregroundStyle(Theme.ink)
                        Text(OfficialRankingList.otherLabel(list)).font(.subheadline).foregroundStyle(Theme.muted)
                        if !row.place.isEmpty { Text(row.place).font(.caption).foregroundStyle(Theme.mutedSoft) }
                    }
                }
                .padding(.vertical, Theme.Spacing.xxs)
            }
            if facts.isEmpty {
                Section { Text("No admissions or cost figures on file for this school.").foregroundStyle(Theme.muted) }
            } else {
                Section("Facts") {
                    ForEach(facts, id: \.0) { fact($0.0, $0.1) }
                }
            }
            Section("Also ranked") {
                if others.isEmpty {
                    Text("Not on the other lists here.").foregroundStyle(Theme.muted)
                } else {
                    ForEach(others, id: \.0) { fact(OfficialRankingList.otherLabel($0.0), "#\($0.1)") }
                }
            }
            if let site = row.facts?.website, let url = URL(string: "https://\(site)") {
                Section {
                    Link(site.replacingOccurrences(of: "www.", with: ""), destination: url)
                        .foregroundStyle(Theme.accent)
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(row.name)
        .navigationBarTitleDisplayMode(.inline)
        .forgeScreenBackground()
    }

    private var facts: [(String, String)] {
        let f = row.facts
        var out: [(String, String?)] = [
            ("Admit rate", f?.admitRate.map { "\($0.formatted(.number.precision(.fractionLength(0...1))))%" }),
            ("SAT middle 50%", f?.sat),
            ("Sticker cost / yr", f?.cost.map(Self.money)),
            ("Median salary (Forbes)", f?.salary.map(Self.money)),
            ("Undergraduates", f?.undergrads.map { Int($0.rounded()).formatted() }),
            ("Setting", f?.setting),
        ]
        if list == "niche", let reviews = row.reviews {
            out.append(("Niche reviews", row.stars.map { "\($0.formatted()) ★ from \(reviews.formatted())" } ?? reviews.formatted()))
        }
        return out.compactMap { label, value in value.map { (label, $0) } }
    }

    private var others: [(String, Int)] {
        let order = OfficialRankingList.allCases.map(\.rawValue)
        return (row.elsewhere ?? [:]).sorted { (order.firstIndex(of: $0.key) ?? 9) < (order.firstIndex(of: $1.key) ?? 9) }
            .map { ($0.key, $0.value) }
    }

    private static func money(_ v: Double) -> String {
        "$" + Int(v.rounded()).formatted()
    }

    private func fact(_ label: String, _ value: String) -> some View {
        LabeledContent(label) {
            Text(value).font(.forgeNumber(.subheadline)).foregroundStyle(Theme.ink).multilineTextAlignment(.trailing)
        }
        .font(.subheadline)
    }
}
