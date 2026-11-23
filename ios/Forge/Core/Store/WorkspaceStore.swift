import Foundation
import Observation

/// The signed-in student's data: the workspace and the applications tracker. Shared by every tab through
/// `@Environment(WorkspaceStore.self)`. All writes go through `patch`, `postAction` or `perform`, which apply
/// optimistic changes and reconcile with the server's reply (see `Reconciled`).
@MainActor
@Observable
final class WorkspaceStore {
    enum Phase: Equatable {
        case idle
        case loading
        case loaded
        case failed(APIError)
    }

    let api: APIClient
    var config: AppConfig { api.config }

    /// First-load state. After the first success it stays `.loaded`; later refresh failures go to `refreshError`.
    private(set) var phase: Phase = .idle
    private(set) var isRefreshing = false
    /// The last background refresh failure, for an `ErrorBanner`. Cleared by the next success.
    var refreshError: APIError?

    private var workspaceState = Reconciled<Workspace>(revision: { $0.revision })
    private var trackerState = Reconciled<TrackerView>(revision: { $0.revision })
    /// Bumped by `reset()`. A reply to a request started before then belongs to the previous account and is dropped.
    @ObservationIgnored private var generation = 0

    /// Called when a request finds the session has ended.
    @ObservationIgnored var onSignedOut: (() -> Void)?

    init(api: APIClient) {
        self.api = api
    }

    // MARK: Reading

    var workspace: Workspace { workspaceState.displayed ?? .empty }
    var tracker: TrackerView { trackerState.displayed ?? .empty }
    var applications: [TrackedApplication] { tracker.apps }
    var hasLoaded: Bool { workspaceState.isLoaded && trackerState.isLoaded }

    func application(id: String) -> TrackedApplication? { tracker.app(id: id) }

    // MARK: Loading

    /// First load (shows `phase`). Safe to call again; it does nothing once loaded.
    func loadIfNeeded() async {
        guard !hasLoaded, phase != .loading else { return }
        phase = .loading
        let started = generation
        do {
            try await fetchAll()
            phase = .loaded
        } catch {
            guard generation == started else { return }
            let apiError = APIError.wrap(error)
            handle(apiError)
            phase = .failed(apiError)
        }
    }

    /// Pull-to-refresh and foreground refresh. Keeps showing current data on failure.
    func refresh() async {
        guard hasLoaded else { return await loadIfNeeded() }
        isRefreshing = true
        defer { isRefreshing = false }
        let started = generation
        do {
            try await fetchAll()
            refreshError = nil
        } catch {
            guard generation == started else { return }
            let apiError = APIError.wrap(error)
            handle(apiError)
            if apiError != .cancelled { refreshError = apiError }
        }
    }

    /// Reloads just the tracker (after a push about a portal update).
    func refreshApplications() async {
        let started = generation
        do {
            let tracker = try await api.applications()
            if generation == started { trackerState.receive(tracker) }
        } catch {
            if generation == started { handle(APIError.wrap(error)) }
        }
    }

    /// POST /api/workspace {action:"reset"}. The server replies with the bare workspace (no `data` envelope),
    /// with a new revision and draft key, so onboarding starts again. The tracker is cleared too, so reload it.
    func resetHub() async throws {
        let started = generation
        do {
            let workspace = try await api.resetWorkspace()
            guard generation == started else { return }
            workspaceState.receive(workspace)
        } catch {
            throw handle(APIError.wrap(error))
        }
        await refreshApplications()
    }

    /// Installs data without the network (previews and tests).
    func seed(workspace: Workspace, tracker: TrackerView) {
        workspaceState.receive(workspace)
        trackerState.receive(tracker)
        phase = .loaded
    }

    /// Clears everything (sign-out).
    func reset() {
        generation += 1
        workspaceState.reset()
        trackerState.reset()
        phase = .idle
        refreshError = nil
    }

    private func fetchAll() async throws {
        let started = generation
        async let ws = api.workspace()
        async let apps = api.applications()
        let (workspace, tracker) = try await (ws, apps)
        guard generation == started else { throw APIError.cancelled }
        workspaceState.receive(workspace)
        trackerState.receive(tracker)
    }

    // MARK: Writing

    /// PATCH /api/workspace. `optimistic` changes the displayed workspace immediately; it is rolled back if
    /// the request fails. Throws `APIError` (show `.message`).
    func patch(_ patch: WorkspacePatch, optimistic: ((inout Workspace) -> Void)? = nil) async throws {
        Self.start(&workspaceState, optimistic)
        let started = generation
        do {
            let saved = try await api.patchWorkspace(patch)
            guard generation == started else { throw APIError.cancelled }
            workspaceState.finish(saved)
        } catch {
            guard generation == started else { throw APIError.cancelled }
            workspaceState.finish(nil)
            throw handle(APIError.wrap(error))
        }
    }

    /// POST /api/workspace {action}. Applies the returned workspace. See `APIClient.workspaceAction`.
    @discardableResult
    func postAction(_ action: String, fields: [String: JSONValue] = [:]) async throws -> WorkspaceActionResponse {
        workspaceState.beginWithoutChange()
        let started = generation
        do {
            let response = try await api.workspaceAction(action, fields: fields)
            guard generation == started else { throw APIError.cancelled }
            workspaceState.finish(response.data)
            return response
        } catch {
            guard generation == started else { throw APIError.cancelled }
            workspaceState.finish(nil)
            throw handle(APIError.wrap(error))
        }
    }

    /// POST /api/applications. `optimistic` changes the displayed tracker immediately. The tracker in the
    /// reply replaces the local one.
    @discardableResult
    func perform(_ action: ApplicationAction, optimistic: ((inout TrackerView) -> Void)? = nil) async throws -> ApplicationsResponse {
        Self.start(&trackerState, optimistic)
        let started = generation
        do {
            let response = try await api.applications(action)
            guard generation == started else { throw APIError.cancelled }
            trackerState.finish(response.data)
            return response
        } catch {
            guard generation == started else { throw APIError.cancelled }
            trackerState.finish(nil)
            throw handle(APIError.wrap(error))
        }
    }

    /// Marks a request in flight, applying the optimistic change when there is data to change.
    private static func start<V>(_ state: inout Reconciled<V>, _ change: ((inout V) -> Void)?) {
        if let change, state.begin(change) { return }
        state.beginWithoutChange()
    }

    @discardableResult
    private func handle(_ error: APIError) -> APIError {
        if error == .signedOut { onSignedOut?() }
        return error
    }
}
