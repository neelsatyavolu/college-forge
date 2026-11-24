import SwiftUI

/// Opens one school's career-ranking breakdown.
struct RankingsDetailRoute: Hashable {
    let row: RankingsRow
    let path: Bool
}

/// Career rankings: colleges ranked on how well set up the student would be for a career in the majors they can reach.
struct RankingsView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(RankingsModel.self) private var model
    @State private var showSettings = false
    @State private var showMethod = false

    var body: some View {
        content
            .task(id: model.request) { await model.load(api: store.api, debounce: model.response != nil) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: {
                        Label("Adjust the ranking", systemImage: "slider.horizontal.3")
                    }
                    .disabled(model.response == nil)
                }
            }
            .sheet(isPresented: $showSettings) {
                if let response = model.response {
                    RankingsSettingsSheet(response: response)
                        .presentationDetents([.medium, .large])
                        .presentationDragIndicator(.visible)
                }
            }
            .sheet(isPresented: $showMethod) {
                RankingsMethodSheet(total: model.response?.total ?? 0)
                    .presentationDragIndicator(.visible)
            }
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .idle, .loading:
            LoadingView(label: "Ranking colleges…")
        case .failed(let error):
            ErrorStateView(error: error) { await model.load(api: store.api, debounce: false) }
        case .loaded(let response):
            list(response)
        }
    }

    private func list(_ response: RankingsResponse) -> some View {
        List {
            Section {
                RankingsTabStrip(tabs: response.tabs, selected: response.view) { model.select(view: $0) }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            .listSectionSpacing(Theme.Spacing.xs)

            if let ai = response.ai {
                aiSection(ai)
            } else {
                Section {
                    ForEach(response.rows) { row in
                        NavigationLink(value: RankingsDetailRoute(row: row, path: response.isPath)) {
                            RankingsRowView(row: row, path: response.isPath, config: store.config)
                        }
                    }
                } header: {
                    header(response)
                } footer: {
                    footer(response)
                }
            }
        }
        .listStyle(.insetGrouped)
        .contentMargins(.top, Theme.Spacing.xxs, for: .scrollContent)
        .opacity(model.isUpdating ? 0.6 : 1)
        .animation(.easeOut(duration: 0.15), value: model.isUpdating)
        .refreshable { await model.load(api: store.api, debounce: false) }
    }

    private func header(_ response: RankingsResponse) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(response.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
            Text(resultLine(response)).foregroundStyle(Theme.muted)
        }
        .font(.footnote)
        .textCase(nil)
        .padding(.bottom, Theme.Spacing.xxs)
    }

    private func resultLine(_ response: RankingsResponse) -> String {
        let count = response.rows.count
        var line = "\(count) \(count == 1 ? "school" : "schools")"
        if response.view == "admitted" {
            line += ", ranked against each other on the same scale as My path."
        } else if response.isPath {
            line += ", each scored on the major you picked that you can reach and where it does best. Cost never counts."
        } else {
            line += ". Cost never counts."
        }
        return line
    }

    private func footer(_ response: RankingsResponse) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            if !response.missing.isEmpty {
                Text("Not ranked here: \(response.missing.joined(separator: ", ")). These schools don’t offer it as a bachelor’s major, or have too few federally aided graduates for pay to be published.")
            }
            Button("How the ranking works") { showMethod = true }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.accent)
        }
        .padding(.top, Theme.Spacing.xs)
    }

    private func aiSection(_ ai: RankingsAiList) -> some View {
        Section {
            ForEach(Array(ai.list.enumerated()), id: \.offset) { _, item in
                RankingsAiRow(item: item, config: store.config)
            }
        } header: {
            VStack(alignment: .leading, spacing: 2) {
                Text("Your judged list").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                Text("\(ai.list.count) schools, ranked by hand\(ai.made.isEmpty ? "" : " (\(ai.made))"). Formula is your My path rank at default settings. Only you can see this list.")
                    .foregroundStyle(Theme.muted)
            }
            .font(.footnote)
            .textCase(nil)
        } footer: {
            if !ai.about.isEmpty { Text(ai.about).padding(.top, Theme.Spacing.xs) }
        }
    }
}

/// Horizontally scrolling view chips: My path, Admitted, AI My Path, All majors, then one per major.
private struct RankingsTabStrip: View {
    let tabs: [RankingsTab]
    let selected: String
    let onSelect: (String) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Spacing.xs) {
                    ForEach(tabs) { tab in
                        let isOn = tab.id == selected
                        Button {
                            Haptics.selection()
                            onSelect(tab.id)
                        } label: {
                            Text(tab.label)
                                .font(.subheadline.weight(isOn ? .semibold : .regular))
                                .padding(.horizontal, Theme.Spacing.sm)
                                .padding(.vertical, 7)
                                .foregroundStyle(isOn ? Theme.canvas : Theme.body)
                                .background(isOn ? Theme.accent : Theme.fill, in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(isOn ? .isSelected : [])
                        .id(tab.id)
                    }
                }
                .padding(.horizontal, Theme.Spacing.md)
                .padding(.vertical, Theme.Spacing.xxs)
            }
            .onAppear { proxy.scrollTo(selected, anchor: .center) }
        }
    }
}

/// One ranked school: rank, logo, name, what it was scored on and a score bar.
struct RankingsRowView: View {
    let row: RankingsRow
    let path: Bool
    let config: AppConfig

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.sm) {
            VStack(spacing: 0) {
                Text(row.rank)
                    .font(.forgeNumber(.headline, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                if let range = row.range {
                    Text(range).font(.forgeNumber(.caption2)).foregroundStyle(Theme.mutedSoft)
                }
            }
            .frame(width: 40)
            SchoolLogo(name: row.name, path: row.logo, config: config, size: 36)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: Theme.Spacing.xxs) {
                    Text(row.name).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                    if row.admitted { RankingsAdmittedBadge() }
                }
                Text(row.place).font(.caption).foregroundStyle(Theme.muted)
                if !row.notes.isEmpty {
                    Text(row.notes.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(Theme.mutedSoft)
                        .lineLimit(2)
                }
                RankingsScoreBar(score: row.score)
                    .padding(.top, 2)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

struct RankingsScoreBar: View {
    let score: Int

    var body: some View {
        HStack(spacing: Theme.Spacing.xs) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.fill)
                    Capsule().fill(Theme.accent).frame(width: geo.size.width * CGFloat(max(3, score)) / 100)
                }
            }
            .frame(height: 5)
            Text("\(score)")
                .font(.forgeNumber(.caption, weight: .semibold))
                .foregroundStyle(Theme.body)
                .frame(minWidth: 22, alignment: .trailing)
        }
        .accessibilityLabel("Score \(score) of 100")
    }
}

struct RankingsAdmittedBadge: View {
    var body: some View {
        Text("Admitted")
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .foregroundStyle(Theme.success)
            .background(Theme.success.opacity(0.14), in: Capsule())
    }
}

private struct RankingsAiRow: View {
    let item: RankingsAiItem
    let config: AppConfig

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.sm) {
            Text(item.rank)
                .font(.forgeNumber(.headline, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .frame(width: 40)
            SchoolLogo(name: item.school, path: item.logo, config: config, size: 36)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: Theme.Spacing.xxs) {
                    Text(item.school).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                    if item.admitted { RankingsAdmittedBadge() }
                }
                if let place = item.place { Text(place).font(.caption).foregroundStyle(Theme.muted) }
                if !item.why.isEmpty { Text(item.why).font(.callout).foregroundStyle(Theme.body) }
                Text("Formula \(item.formula ?? "—")").font(.forgeNumber(.caption)).foregroundStyle(Theme.mutedSoft)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}
