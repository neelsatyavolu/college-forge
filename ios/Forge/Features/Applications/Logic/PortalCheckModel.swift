import Foundation
import Observation

/// Runs "Check now" for one or many portals, three at a time, like checkSome in public/hub/Applications.jsx.
/// Shared by the list and the detail screen so a check started in one shows in the other.
@MainActor
@Observable
final class PortalCheckModel {
    private(set) var checking: Set<String> = []
    /// "Checked 2 of 5…" while a batch runs.
    private(set) var progress: String?
    /// The result of the last batch, shown as a toast.
    var notice: String?
    var error: APIError?

    var isChecking: Bool { !checking.isEmpty }

    func isChecking(_ id: String) -> Bool { checking.contains(id) }

    func check(_ apps: [TrackedApplication], store: WorkspaceStore) async {
        let ids = apps.map(\.id).filter { !checking.contains($0) }
        guard !ids.isEmpty else { return }
        checking.formUnion(ids)
        notice = nil
        var done = 0, failed = 0
        var lastError: APIError?

        await withTaskGroup(of: (String, Bool, APIError?).self) { group in
            var queue = ids[...]
            func next() {
                guard let id = queue.popFirst() else { return }
                group.addTask { await Self.checkOne(id, store: store) }
            }
            for _ in 0..<min(3, ids.count) { next() }
            for await (id, ok, error) in group {
                done += 1
                if !ok { failed += 1 }
                if let error { lastError = error }
                checking.remove(id)
                if ids.count > 1 { progress = "Checked \(done) of \(ids.count)…" }
                next()
            }
        }

        progress = nil
        if let lastError, failed == ids.count {
            error = lastError
            Haptics.error()
        } else {
            notice = ApplicationsValidation.checkSummary(total: ids.count, failed: failed)
            failed > 0 ? Haptics.warning() : Haptics.success()
        }
    }

    private static func checkOne(_ id: String, store: WorkspaceStore) async -> (String, Bool, APIError?) {
        do {
            let response = try await store.perform(.check(ids: [id]))
            let result = response.checked?.first
            let ok = !(result?.lastFailure != nil || result?.portal?.ok == false)
            return (id, ok, nil)
        } catch {
            return (id, false, APIError.wrap(error))
        }
    }
}
