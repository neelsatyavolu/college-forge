import Foundation
import Observation

/// Runs "Estimate my chances" the way the web hub does: the AI reads the application once, then estimates
/// a few schools at a time. Success is counted only from what was actually saved to the workspace.
@MainActor
@Observable
final class CollegesChancesModel {
    struct Outcome: Equatable {
        var text: String
        var isError: Bool
    }

    private(set) var isRunning = false
    private(set) var progress = ""
    private(set) var outcome: Outcome?

    private var shortlistMetadata: CollegesShortlistMetadata?
    private(set) var metadataError: APIError?

    func metadata(for workspace: Workspace) -> CollegesShortlistMetadata? {
        guard let shortlistMetadata, shortlistMetadata.draftStorageKey == workspace.draftStorageKey,
              shortlistMetadata.revision == workspace.revision else { return nil }
        return shortlistMetadata
    }

    func loadMetadata(store: WorkspaceStore) async {
        guard metadata(for: store.workspace) == nil else { return }
        metadataError = nil
        do {
            let snapshot = try await store.api.collegesShortlistMetadata()
            try Task.checkCancellation()
            guard snapshot.draftStorageKey == store.workspace.draftStorageKey else { return }
            shortlistMetadata = snapshot
            if snapshot.revision > store.workspace.revision { await store.refresh() }
        } catch {
            if !Task.isCancelled { metadataError = APIError.wrap(error) }
        }
    }

    private static let concurrency = 3

    func run(store: WorkspaceStore) async {
        guard !isRunning else { return }
        isRunning = true
        outcome = nil
        progress = "Starting…"
        defer {
            isRunning = false
            progress = ""
        }
        do {
            outcome = try await estimate(store: store)
            Haptics.success()
        } catch {
            let apiError = APIError.wrap(error)
            outcome = Outcome(text: apiError == .cancelled ? "Stopped." : apiError.message, isError: true)
            Haptics.error()
        }
        await store.refresh()
    }

    private func estimate(store: WorkspaceStore) async throws -> Outcome {
        let api = store.api
        let before = try await api.workspace()
        let scope = before.draftStorageKey
        let readBefore = before.applicationRead?.readAt ?? ""
        progress = "Looking up admission rates…"
        let plan = try await api.collegesOddsPlan()
        if plan.schools.isEmpty {
            return Outcome(text: "Every school on your list already has a decision.", isError: false)
        }

        if let read = plan.read {
            try await api.collegesRunPrompt(read.prompt) { [weak self] message in
                await self?.report("Reading your application: \(message)")
            }
        }
        let afterRead = try await api.workspace()
        guard afterRead.draftStorageKey == scope else { throw Self.stopped }
        guard let read = afterRead.applicationRead, read.readAt != readBefore else {
            throw APIError.server(status: 200, message: "The AI didn't save its read of your application. Estimates need ChatGPT or Grok connected in Settings.")
        }

        try await runSteps(plan.schools, api: api)

        let after = try await api.workspace()
        guard after.draftStorageKey == scope else { throw Self.stopped }
        let keys = plan.schools.flatMap(\.keys)
        let missed = CollegesOdds.missedKeys(keys, before: before.admissionOdds, after: after.admissionOdds)
            .map { CollegesOdds.name(for: $0, in: after, apps: store.applications) }
        if missed.isEmpty { return Outcome(text: "Estimated all \(keys.count) schools.", isError: false) }
        return Outcome(
            text: "Estimated \(keys.count - missed.count) of \(keys.count) schools. Not saved for: \(missed.joined(separator: ", ")). Run it again to retry.",
            isError: true
        )
    }

    /// Up to three steps at once. A failed step is not fatal; it shows up as a missed school.
    private func runSteps(_ steps: [CollegesOddsPlan.Step], api: APIClient) async throws {
        doneCount = 0
        let total = steps.count
        let model = self
        try await withThrowingTaskGroup(of: Void.self) { group in
            var pending = steps[...]
            for _ in 0..<Self.concurrency {
                guard let step = pending.popFirst() else { break }
                group.addTask { await Self.runStep(step, api: api, model: model, total: total) }
            }
            while try await group.next() != nil {
                doneCount += 1
                try Task.checkCancellation()
                if let step = pending.popFirst() {
                    group.addTask { await Self.runStep(step, api: api, model: model, total: total) }
                }
            }
        }
    }

    private nonisolated static func runStep(_ step: CollegesOddsPlan.Step, api: APIClient, model: CollegesChancesModel, total: Int) async {
        do {
            try await api.collegesRunPrompt(step.prompt) { message in
                await model.reportStep(step.label, message, total: total)
            }
        } catch {
            // Counted afterwards from what was saved, like the web hub.
        }
    }

    private var doneCount = 0

    private func report(_ message: String) {
        progress = message
    }

    private func reportStep(_ label: String, _ message: String, total: Int) {
        progress = "Schools \(doneCount) of \(total) done · \(label): \(message)"
    }

    private static let stopped = APIError.server(status: 200, message: "Your workspace changed, so the estimate stopped.")
}
