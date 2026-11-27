import SwiftUI

/// GET /api/rankings/list: the web List tab, computed on the server (public/hub/rank-list.js).
struct RankListResponse: Decodable, Sendable {
    struct Row: Decodable, Sendable, Identifiable, Hashable {
        let id: String
        let name: String
        /// Place on the list; nil for a school no ranking covers.
        let position: Int?
        /// Weighted average rank, to one decimal; nil when unranked.
        let average: Double?
        /// "USN #12 · Niche #9 · …", or "Not ranked".
        let summary: String
        /// The same ranks spelled out, for VoiceOver.
        let detail: String
        /// "admitted", "committed", or nil.
        let outcome: String?
    }

    let rows: [Row]
    let copyText: String
}

extension APIClient {
    func rankList() async throws -> RankListResponse {
        try await get("/api/rankings/list")
    }
}

/// "List" view: every application ordered by a weighted average of six rankings, like the website's List tab.
struct ApplicationsRankList: View {
    let picker: ApplicationsModePicker
    @Environment(WorkspaceStore.self) private var store
    @State private var response: RankListResponse?
    @State private var error: APIError?
    @State private var copied = false

    var body: some View {
        List {
            Section { picker }
            content
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .refreshable {
            await store.refresh()
            await load()
        }
        // Reload when schools are added, removed, renamed or change status.
        .task(id: reloadKey) { await load() }
    }

    @ViewBuilder private var content: some View {
        if store.applications.isEmpty {
            ContentUnavailableView(
                "No schools yet",
                systemImage: "list.number",
                description: Text("Add schools and they’ll show up here, best average rank first.")
            )
            .listRowBackground(Color.clear)
        } else if let response {
            Section {
                ForEach(response.rows) { row in
                    NavigationLink(value: ApplicationRoute(id: row.id)) { RankListRow(row: row, logo: logo(for: row.id), config: store.config) }
                }
            } header: {
                HStack {
                    ApplicationsSectionHeader(title: "By average rank", count: nil, tone: nil)
                    Spacer()
                    Button(copied ? "Copied" : "Copy colleges", action: { copy(response.copyText) })
                        .font(.footnote.weight(.medium))
                        .textCase(nil)
                }
            } footer: {
                Text("U.S. News, Forbes and your career ranking (My path) count fully; Niche ¾, since part of it is student reviews; WSJ ½, since it swings year to year; the Princeton Review ¼, since it rates cost and aid. Liberal arts, Princeton Review and career ranks count at the national rank of the same standing, and a list a school isn’t on is left out.")
            }
        } else if error != nil {
            ContentUnavailableView {
                Label("Couldn’t load the rankings", systemImage: "exclamationmark.triangle")
            } description: {
                Text("Check your connection and try again.")
            } actions: {
                Button("Try again") { Task { await load() } }
            }
            .listRowBackground(Color.clear)
        } else {
            ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
        }
    }

    private var reloadKey: [String] {
        store.applications.map { "\($0.id)|\($0.name)|\($0.status.rawValue)|\($0.round)" }
    }

    private func logo(for id: String) -> String? {
        store.applications.first { $0.id == id }?.logo
    }

    private func load() async {
        guard !store.applications.isEmpty else { return }
        do {
            let next = try await store.api.rankList()
            response = next
            error = nil
        } catch {
            let apiError = APIError.wrap(error)
            guard apiError != .cancelled, !Task.isCancelled else { return }
            if response == nil { self.error = apiError }
        }
    }

    private func copy(_ text: String) {
        UIPasteboard.general.string = text
        Haptics.selection()
        copied = true
        Task {
            try? await Task.sleep(for: .seconds(1.8))
            copied = false
        }
    }
}

private struct RankListRow: View {
    let row: RankListResponse.Row
    let logo: String?
    let config: AppConfig

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            Text(row.position.map(String.init) ?? "")
                .font(.forgeNumber(.subheadline, weight: .semibold))
                .foregroundStyle(Theme.muted)
                .frame(width: 24, alignment: .trailing)
            SchoolLogo(name: row.name, path: logo, config: config, size: 36)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: Theme.Spacing.xxs) {
                    Text(row.name).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                    if let outcome = row.outcome {
                        Text(outcome == "committed" ? "Committed" : "Admitted")
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .foregroundStyle(Theme.success)
                            .background(Theme.success.opacity(0.14), in: Capsule())
                    }
                }
                Text(row.summary).font(.caption).foregroundStyle(Theme.muted)
            }
            Spacer(minLength: Theme.Spacing.xs)
            Text(row.average.map { $0.formatted(.number.precision(.fractionLength(1))) } ?? "—")
                .font(.forgeNumber(.headline, weight: .semibold))
                .foregroundStyle(Theme.ink)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        guard let position = row.position, let average = row.average else { return "\(row.name), not ranked" }
        let outcome = row.outcome.map { $0 == "committed" ? ", committed" : ", admitted" } ?? ""
        return "\(position). \(row.name)\(outcome). Average rank \(average.formatted(.number.precision(.fractionLength(1)))). \(row.detail)"
    }
}
