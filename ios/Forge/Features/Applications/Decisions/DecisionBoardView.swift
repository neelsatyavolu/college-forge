import SwiftUI

/// The Decision board, pushed from Decisions: the AI's picks, the two side by side, then every offer with
/// its advantages and disadvantages. Read only apart from asking for new picks; aid offers are entered on the web.
struct DecisionBoardView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(SessionModel.self) private var session
    @State private var board: DecisionBoardResponse?
    @State private var error: APIError?
    @State private var running = false
    @State private var progress = ""
    @State private var pickError: String?

    var body: some View {
        List { content }
            .listStyle(.insetGrouped)
            .listSectionSpacing(.compact)
            .navigationTitle("Decision board")
            .navigationBarTitleDisplayMode(.inline)
            .forgeScreenBackground()
            .refreshable { await load() }
            .task(id: reloadKey) { await load() }
            .toolbar {
                if let board, board.schools.contains(where: \.pickable) {
                    ToolbarItem(placement: .primaryAction) {
                        Button(board.picks == nil ? "Get picks" : "Refresh") { Task { await getPicks() } }
                            .disabled(running)
                    }
                }
            }
            .alert("Couldn’t get picks", isPresented: Binding(get: { pickError != nil }, set: { if !$0 { pickError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(pickError ?? "")
            }
    }

    @ViewBuilder private var content: some View {
        if let board {
            if running {
                Section { Label(progress.isEmpty ? "Comparing your offers…" : progress, systemImage: "sparkles").foregroundStyle(Theme.muted) }
            }
            if board.schools.isEmpty {
                ContentUnavailableView("No offers yet", systemImage: "envelope.open", description: Text("When you record an admission, the school shows up here."))
                    .listRowBackground(Color.clear)
            }
            if let picks = board.picks { picksSection(picks, board: board) }
            if !board.schools.isEmpty {
                Section {
                    ForEach(board.schools) { DecisionBoardSchoolRow(school: $0, config: store.config) }
                } header: {
                    ApplicationsSectionHeader(title: "Every offer", count: board.schools.count, tone: nil)
                } footer: {
                    Text(footer(board))
                }
            }
        } else if error != nil {
            ContentUnavailableView {
                Label("Couldn’t load the board", systemImage: "exclamationmark.triangle")
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

    @ViewBuilder private func picksSection(_ picks: DecisionBoardResponse.Picks, board: DecisionBoardResponse) -> some View {
        Section {
            if board.stale {
                Label("Something changed since these picks were made. Refresh to include it.", systemImage: "clock.arrow.circlepath")
                    .font(.footnote)
                    .foregroundStyle(Theme.coral)
            }
            ForEach(Array(picks.picks.enumerated()), id: \.element.appId) { index, pick in
                VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
                    Text("\(index + 1). \(name(pick.appId, in: board))").font(.forgeDisplay(.title3)).foregroundStyle(Theme.ink)
                    Text(pick.headline).font(.subheadline.weight(.medium)).foregroundStyle(Theme.ink)
                    Text(pick.why).font(.subheadline).foregroundStyle(Theme.body)
                    if !pick.watchOut.isEmpty {
                        Text("Watch out: \(pick.watchOut)").font(.footnote).foregroundStyle(Theme.muted)
                    }
                }
                .padding(.vertical, Theme.Spacing.xxs)
                .accessibilityElement(children: .combine)
            }
            if !picks.summary.isEmpty {
                Text(picks.summary).font(.subheadline).foregroundStyle(Theme.ink)
            }
        } header: {
            ApplicationsSectionHeader(title: picks.picks.count > 1 ? "Your two best picks" : "Your best pick", count: nil, tone: nil)
        }
        if picks.picks.count == 2 {
            let a = name(picks.picks[0].appId, in: board), b = name(picks.picks[1].appId, in: board)
            Section {
                ForEach(Array(compareRows(picks, board: board).enumerated()), id: \.offset) { _, row in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(row.label).font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .top, spacing: Theme.Spacing.md) {
                                cell(a, row.a).frame(maxWidth: .infinity, alignment: .leading)
                                cell(b, row.b).frame(maxWidth: .infinity, alignment: .leading)
                            }
                            VStack(alignment: .leading, spacing: 4) { cell(a, row.a); cell(b, row.b) }
                        }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(row.label). \(a): \(row.a.isEmpty ? "none" : row.a). \(b): \(row.b.isEmpty ? "none" : row.b).")
                }
            } header: {
                ApplicationsSectionHeader(title: "Side by side", count: nil, tone: nil)
            }
        }
    }

    private func cell(_ school: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(school).font(.caption2).foregroundStyle(Theme.mutedSoft)
            Text(value.isEmpty ? "—" : value).font(.subheadline).foregroundStyle(Theme.body)
        }
    }

    private func compareRows(_ picks: DecisionBoardResponse.Picks, board: DecisionBoardResponse) -> [DecisionBoardResponse.Row] {
        let schools = picks.picks.map { p in board.schools.first { $0.id == p.appId } }
        guard let first = schools[0], let second = schools[1] else { return picks.rows }
        let rank: (DecisionBoardResponse.School) -> String = { $0.average.map { String(format: "%.1f", $0) } ?? "Not ranked" }
        let switching: (DecisionBoardResponse.School) -> String = { $0.switch.map { "\($0.major): \($0.label)" }.joined(separator: "; ") }
        return picks.rows + [
            .init(label: "Average rank", a: rank(first), b: rank(second)),
            .init(label: "Yearly cost", a: first.costText, b: second.costText),
            .init(label: "Switching", a: switching(first), b: switching(second)),
        ]
    }

    private func footer(_ board: DecisionBoardResponse) -> String {
        let judged = board.targets.isEmpty ? "" : "Judged for \(board.targets.joined(separator: ", ")). "
        return judged + "Waitlisted and deferred schools are shown but never picked. Add aid offers on the website. Only you see this."
    }

    private func name(_ id: String, in board: DecisionBoardResponse) -> String {
        board.schools.first { $0.id == id }?.name ?? "A school no longer on the board"
    }

    private var reloadKey: [String] {
        store.applications.map { "\($0.id)|\($0.status.rawValue)|\($0.notes)" }
    }

    private func load() async {
        do {
            board = try await store.api.decisionBoard()
            error = nil
        } catch {
            let apiError = APIError.wrap(error)
            guard apiError != .cancelled, !Task.isCancelled else { return }
            if board == nil { self.error = apiError }
        }
    }

    private func getPicks() async {
        running = true
        defer { running = false; progress = "" }
        let before = board?.picks?.madeAt
        guard let email = session.user?.email, !email.isEmpty else {
            pickError = "Sign in again to use your connected AI."
            return
        }
        do {
            let plan = try await store.api.decisionPlan()
            let ai = MoreAIClient(api: store.api, accountEmail: email)
            try await ai.decisionRunPicks(plan.step.prompt, provider: MoreAIPreferences.load().preferred) { message in
                await MainActor.run { progress = message }
            }
            let next = try await store.api.decisionBoard()
            board = next
            if next.picks == nil || next.picks?.madeAt == before {
                pickError = "The AI didn’t save picks. Picks need ChatGPT or Grok connected in More › AI."
            } else {
                Haptics.success()
            }
        } catch {
            let apiError = APIError.wrap(error)
            guard apiError != .cancelled else { return }
            pickError = apiError.localizedDescription
        }
    }
}

/// One offer: standing, rank, cost, then advantages and disadvantages as plain lines.
private struct DecisionBoardSchoolRow: View {
    let school: DecisionBoardResponse.School
    let config: AppConfig

    var body: some View {
        NavigationLink(value: ApplicationRoute(id: school.id)) {
            HStack(alignment: .top, spacing: Theme.Spacing.sm) {
                SchoolLogo(name: school.name, path: school.logo, config: config, size: 36)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(school.name).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                        Spacer(minLength: Theme.Spacing.xs)
                        Text(school.average.map { String(format: "#%.1f", $0) } ?? "Unranked")
                            .font(.footnote.monospacedDigit())
                            .foregroundStyle(Theme.ink)
                    }
                    Text(school.standingLabel).font(.caption.weight(.semibold)).foregroundStyle(school.pickable ? Theme.accent : Theme.coral)
                    Text(school.costText).font(.footnote.monospacedDigit()).foregroundStyle(Theme.body)
                    if let details = school.aidOffer?.boardDetails {
                        Text(details).font(.footnote).foregroundStyle(Theme.muted)
                    }
                    if !school.awards.isEmpty {
                        Text("Awards: " + school.awards.map { $0.amount.isEmpty ? $0.name : "\($0.name) (\($0.amount))" }.joined(separator: ", "))
                            .font(.footnote).foregroundStyle(Theme.muted)
                    }
                    if !school.careerCovered {
                        Text("Not in the career data, so no pay or switching facts.").font(.footnote).foregroundStyle(Theme.muted)
                    }
                    ForEach(school.pros, id: \.self) { Text("+ \($0)").font(.footnote).foregroundStyle(Theme.body) }
                    ForEach(school.cons, id: \.self) { Text("− \($0)").font(.footnote).foregroundStyle(Theme.muted) }
                    if !school.switch.isEmpty {
                        Text("Switching: " + school.switch.map { "\($0.major) \($0.label)" }.joined(separator: " · "))
                            .font(.footnote).foregroundStyle(Theme.muted)
                    }
                    if !school.notes.isEmpty {
                        Text("Your notes: \(school.notes)").font(.footnote).foregroundStyle(Theme.body).lineLimit(3)
                    }
                    if !school.decisionNote.isEmpty {
                        Text(school.decisionNote).font(.footnote).foregroundStyle(Theme.body).lineLimit(3)
                    }
                }
            }
            .padding(.vertical, Theme.Spacing.xxs)
        }
        .accessibilityHint("Opens \(school.name)")
    }
}
