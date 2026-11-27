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
    /// Done over total, counting the read step plus one per school (0 before the read finishes).
    private(set) var fraction = 0.0
    private(set) var outcome: Outcome?
    /// "Assess all" on the shortlist: running, and what it last reported.
    private(set) var isAssessing = false
    private(set) var assessOutcome: CollegesAssess.Outcome?

    /// Either job is running; they share the progress line and the AI.
    var isBusy: Bool { isRunning || isAssessing }

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
        guard !isBusy else { return }
        isRunning = true
        outcome = nil
        progress = "Starting…"
        defer {
            isRunning = false
            progress = ""
            fraction = 0
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

    /// Data tiers first (grades and scores against each school's numbers); for the rest, the AI chance estimate,
    /// then a tier from it on the server (70%+ likely, 30-69% target, under 30% reach). Mirrors Shortlist.jsx.
    func assessAll(store: WorkspaceStore) async {
        guard !isBusy else { return }
        isAssessing = true
        assessOutcome = nil
        progress = "Sorting schools from your grades and scores…"
        defer {
            isAssessing = false
            progress = ""
            fraction = 0
        }
        var sorted = 0
        do {
            var result = try await store.shortlistAssessTiers()
            sorted += result.assessed.count
            if !result.unknown.isEmpty {
                progress = "Estimating your chances with AI for \(CollegesAssess.schools(result.unknown.count))…"
                _ = try await estimate(store: store)
                result = try await store.shortlistAssessTiers()
                sorted += result.assessed.count
            }
            assessOutcome = .init(notice: CollegesAssess.summary(sorted: sorted, left: result.unknown), error: nil)
            Haptics.success()
        } catch {
            let apiError = APIError.wrap(error)
            assessOutcome = .init(notice: sorted > 0 ? "Sorted \(CollegesAssess.schools(sorted))." : "",
                                  error: apiError == .cancelled ? "Stopped." : apiError.message)
            Haptics.error()
        }
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

        let keys = plan.schools.flatMap(\.keys)
        doneCount = 0
        total = 1 + keys.count
        fraction = 1 / Double(total)
        try await runSteps(plan.schools, api: api, retry: false)

        // Schools whose estimate didn't save get one more try in the same run.
        let mid = try await api.workspace()
        guard mid.draftStorageKey == scope else { throw Self.stopped }
        let retry = plan.schools.filter { !CollegesOdds.missedKeys($0.keys, before: before.admissionOdds, after: mid.admissionOdds).isEmpty }
        if !retry.isEmpty { try await runSteps(retry, api: api, retry: true) }

        let after = retry.isEmpty ? mid : try await api.workspace()
        guard after.draftStorageKey == scope else { throw Self.stopped }
        let missed = CollegesOdds.missedKeys(keys, before: before.admissionOdds, after: after.admissionOdds)
            .map { CollegesOdds.name(for: $0, in: after, apps: store.applications) }
        if missed.isEmpty { return Outcome(text: "Estimated all \(keys.count) schools.", isError: false) }
        return Outcome(
            text: "Estimated \(keys.count - missed.count) of \(keys.count) schools. Not saved for: \(missed.joined(separator: ", ")). Run it again to retry.",
            isError: true
        )
    }

    /// Up to three steps at once. A failed step is not fatal; it shows up as a missed school. A retry pass
    /// doesn't move the count, which already includes those schools.
    private func runSteps(_ steps: [CollegesOddsPlan.Step], api: APIClient, retry: Bool) async throws {
        let model = self
        let tag = retry ? "Retrying " : ""
        try await withThrowingTaskGroup(of: Int.self) { group in
            var pending = steps[...]
            for _ in 0..<Self.concurrency {
                guard let step = pending.popFirst() else { break }
                group.addTask { await Self.runStep(step, tag: tag, api: api, model: model) }
            }
            while let finished = try await group.next() {
                if !retry { doneCount += finished }
                reportDone()
                try Task.checkCancellation()
                if let step = pending.popFirst() {
                    group.addTask { await Self.runStep(step, tag: tag, api: api, model: model) }
                }
            }
        }
    }

    /// Runs one step and returns how many schools it covers.
    private nonisolated static func runStep(_ step: CollegesOddsPlan.Step, tag: String, api: APIClient, model: CollegesChancesModel) async -> Int {
        do {
            try await api.collegesRunPrompt(step.prompt) { message in
                await model.report("\(tag)\(step.label): \(message)")
            }
        } catch {
            // Counted afterwards from what was saved, like the web hub.
        }
        return step.keys.count
    }

    private var doneCount = 0
    private var total = 1

    private func report(_ message: String) {
        progress = message
    }

    private func reportDone() {
        progress = "\(doneCount) of \(total - 1) schools estimated"
        fraction = min(1, Double(1 + doneCount) / Double(total))
    }

    private static let stopped = APIError.server(status: 200, message: "Your workspace changed, so the estimate stopped.")
}
