import Foundation
import Observation

/// The career ranking screen's state. Majors, weights and adjustments are saved on the student's workspace,
/// shared with the website; only the selected view is kept on this phone.
@MainActor
@Observable
final class RankingsModel {
    enum State {
        case idle, loading, loaded(RankingsResponse), failed(APIError)
    }

    private static let storageKey = "forge.rankings.request"

    private(set) var state = State.idle
    private(set) var isUpdating = false
    private var loadID = 0
    var request: RankingsRequest {
        didSet { save() }
    }

    init() {
        // Settings saved here by older builds are dropped: the workspace's saved ones apply instead.
        let stored = UserDefaults.standard.data(forKey: Self.storageKey)
            .flatMap { try? JSONDecoder().decode(RankingsRequest.self, from: $0) }
        request = RankingsRequest(view: stored?.view ?? "path")
    }

    var response: RankingsResponse? {
        if case .loaded(let response) = state { return response }
        return nil
    }

    /// Loads the ranking for the current settings. A settings change waits a moment so slider drags send one request.
    func load(api: APIClient, debounce: Bool) async {
        if debounce {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
        }
        loadID += 1
        let id = loadID
        let sent = request
        if response == nil { state = .loading }
        isUpdating = true
        defer { if id == loadID { isUpdating = false } }
        do {
            let response = try await api.rankingsView(sent)
            guard id == loadID, !Task.isCancelled else { return }
            state = .loaded(response)
            // Saved on the workspace now: stop sending these, so a later change on the website isn't overwritten.
            // Edits made while this request ran stay pending.
            if sent.save == true, request == sent { request = RankingsRequest(view: sent.view) }
        } catch {
            let apiError = APIError.wrap(error)
            guard id == loadID, apiError != .cancelled, !Task.isCancelled else { return }
            if response == nil { state = .failed(apiError) }
        }
    }

    /// Drop the stale snapshot so a failed refresh offers a retry after the list has already changed.
    func reloadAfterJudgedListChange(api: APIClient, removed: Bool) async {
        state = .idle
        if removed && request.view == "ai" {
            select(view: "path") // RankingsView loads the newly selected tab.
        } else {
            await load(api: api, debounce: false)
        }
    }

    // MARK: Settings

    func select(view: String) {
        request.view = view
    }

    func weights(defaults: RankingsWeights) -> RankingsWeights {
        request.weights ?? response?.weights ?? defaults
    }

    func setWeight(_ key: String, to value: Double, current: RankingsWeights) {
        var next = current
        next[key] = value
        guard next.values.contains(where: { $0 > 0 }) else { return }
        request.weights = next
        request.save = true
    }

    func flags(current: RankingsFlags) -> RankingsFlags {
        request.flags ?? current
    }

    func setFlags(_ flags: RankingsFlags) {
        request.flags = flags
        request.save = true
    }

    /// Adds or removes a target major. The last one can't be removed.
    func toggleTarget(_ key: String, current: [String], order: [String]) {
        let next = current.contains(key) ? current.filter { $0 != key } : current + [key]
        guard !next.isEmpty else { return }
        request.targets = order.filter(next.contains)
        request.save = true
    }

    func resetSettings(defaults: RankingsDefaults) {
        request.weights = defaults.weights
        request.flags = defaults.flags
        request.save = true
    }

    private func save() {
        if let data = try? JSONEncoder().encode(RankingsRequest(view: request.view)) {
            UserDefaults.standard.set(data, forKey: Self.storageKey)
        }
    }
}
