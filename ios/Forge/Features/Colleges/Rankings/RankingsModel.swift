import Foundation
import Observation

/// The career ranking screen's state. Settings are kept on this phone, like the website keeps them in the browser.
@MainActor
@Observable
final class RankingsModel {
    enum State {
        case idle, loading, loaded(RankingsResponse), failed(APIError)
    }

    private static let storageKey = "forge.rankings.request"

    private(set) var state = State.idle
    private(set) var isUpdating = false
    var request: RankingsRequest {
        didSet { save() }
    }

    init() {
        request = UserDefaults.standard.data(forKey: Self.storageKey)
            .flatMap { try? JSONDecoder().decode(RankingsRequest.self, from: $0) } ?? RankingsRequest()
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
        let sent = request
        if response == nil { state = .loading }
        isUpdating = true
        defer { isUpdating = false }
        do {
            let response = try await api.rankingsView(sent)
            guard !Task.isCancelled else { return }
            state = .loaded(response)
        } catch {
            let apiError = APIError.wrap(error)
            guard apiError != .cancelled, !Task.isCancelled else { return }
            if response == nil { state = .failed(apiError) }
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
    }

    func flags(current: RankingsFlags) -> RankingsFlags {
        request.flags ?? current
    }

    func setFlags(_ flags: RankingsFlags) {
        request.flags = flags
    }

    /// Adds or removes a target major. The last one can't be removed.
    func toggleTarget(_ key: String, current: [String], order: [String]) {
        let next = current.contains(key) ? current.filter { $0 != key } : current + [key]
        guard !next.isEmpty else { return }
        request.targets = order.filter(next.contains)
    }

    func resetSettings() {
        request.weights = nil
        request.flags = nil
    }

    private func save() {
        if let data = try? JSONEncoder().encode(request) {
            UserDefaults.standard.set(data, forKey: Self.storageKey)
        }
    }
}
