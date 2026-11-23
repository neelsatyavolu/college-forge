import UIKit

/// Saves pending drafts when the app leaves the foreground, asking iOS for time to finish.
@MainActor
enum EssayBackgroundSave {
    @MainActor
    private final class Token {
        var id = UIBackgroundTaskIdentifier.invalid

        func end() {
            guard id != .invalid else { return }
            UIApplication.shared.endBackgroundTask(id)
            id = .invalid
        }
    }

    static func flush(_ queue: EssayDraftQueue) {
        guard queue.hasUnsaved else { return }
        let token = Token()
        token.id = UIApplication.shared.beginBackgroundTask(withName: "Save essay drafts") { token.end() }
        Task {
            await queue.flush()
            token.end()
        }
    }
}
