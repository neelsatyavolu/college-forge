import Foundation
import Testing
@testable import Forge

@MainActor
@Suite("Essay draft queue")
struct EssayDraftQueueTests {
    private func tempJournal() -> EssayDraftJournal {
        let dir = FileManager.default.temporaryDirectory.appending(path: "essay-tests-\(UUID().uuidString)")
        return EssayDraftJournal(key: "ws-key", directory: dir)!
    }

    private func makeQueue(_ journal: EssayDraftJournal? = nil) -> EssayDraftQueue {
        EssayDraftQueue(key: "ws-key", journal: journal ?? tempJournal(), debounce: .seconds(60))
    }

    @Test func textPrefersPendingThenServerThenStarter() {
        let queue = makeQueue()
        var essay = Essay(id: "e", label: "E", prompt: "P")
        essay.starter = "starter"
        #expect(queue.text(for: essay, serverDrafts: [:]) == "starter")
        #expect(queue.text(for: essay, serverDrafts: ["e": "server"]) == "server")
        queue.edit(id: "e", text: "local")
        #expect(queue.text(for: essay, serverDrafts: ["e": "server"]) == "local")
    }

    @Test func successfulSaveClearsPendingAndJournal() async {
        let journal = tempJournal()
        let queue = makeQueue(journal)
        var sent: [[String: String]] = []
        queue.save = { sent.append($0) }
        queue.edit(id: "a", text: "one")
        queue.edit(id: "b", text: "two")
        #expect(queue.state == .saving)
        #expect(try! journal.load().get() == ["a": "one", "b": "two"])
        await queue.flush()
        #expect(sent == [["a": "one", "b": "two"]])
        #expect(queue.pending.isEmpty)
        #expect(queue.state == .saved)
        #expect(try! journal.load().get().isEmpty)
    }

    @Test func typingDuringSaveIsKeptAndSentNext() async {
        let queue = makeQueue()
        var sent: [[String: String]] = []
        queue.save = { drafts in
            sent.append(drafts)
            if sent.count == 1 { queue.edit(id: "a", text: "one more") }
        }
        queue.edit(id: "a", text: "one")
        await queue.flush()
        #expect(sent == [["a": "one"], ["a": "one more"]])
        #expect(queue.pending.isEmpty)
    }

    @Test func failureKeepsTextAndShowsError() async {
        let journal = tempJournal()
        let queue = makeQueue(journal)
        queue.save = { _ in throw APIError.offline }
        queue.edit(id: "a", text: "keep me")
        await queue.flush()
        #expect(queue.state == .failed)
        #expect(queue.errorMessage == APIError.offline.message)
        #expect(queue.pending == ["a": "keep me"])
        #expect(try! journal.load().get() == ["a": "keep me"])
        // Typing again clears the error until the next attempt.
        queue.edit(id: "a", text: "keep me too")
        #expect(queue.errorMessage == nil)
    }

    @Test func recoversUnsavedTextFromDisk() {
        let journal = tempJournal()
        journal.write(["a": "from last time"])
        let queue = makeQueue(journal)
        #expect(queue.pending == ["a": "from last time"])
        #expect(queue.hasUnsaved)
    }

    @Test func neverSavesIntoAnotherWorkspace() async {
        let queue = makeQueue()
        var calls = 0
        queue.save = { _ in calls += 1 }
        queue.isCurrent = { false }
        queue.edit(id: "a", text: "x")
        await queue.flush()
        #expect(calls == 0)
        #expect(queue.pending == ["a": "x"])
    }

    @Test func noJournalMeansRecoveryUnavailable() {
        let queue = EssayDraftQueue(key: "", journal: nil, debounce: .seconds(60))
        queue.edit(id: "a", text: "x")
        #expect(queue.storageUnavailable)
    }

    @Test func journalRejectsUnsafeKeys() {
        #expect(EssayDraftJournal(key: "") == nil)
        #expect(EssayDraftJournal(key: "../../") == nil)
        let journal = EssayDraftJournal(key: "../abc-123")
        #expect(journal?.url.lastPathComponent == "abc-123.json")
    }

    @Test func debounceSendsAfterPause() async throws {
        let queue = EssayDraftQueue(key: "k", journal: tempJournal(), debounce: .milliseconds(20))
        var sent: [[String: String]] = []
        queue.save = { sent.append($0) }
        queue.edit(id: "a", text: "h")
        queue.edit(id: "a", text: "hi")
        try await Task.sleep(for: .milliseconds(300))
        #expect(sent == [["a": "hi"]])
    }

    @Test func typingDuringDebouncedSaveDoesNotCancelIt() async throws {
        let queue = EssayDraftQueue(key: "k", journal: tempJournal(), debounce: .milliseconds(10))
        var sent: [[String: String]] = []
        queue.save = { drafts in
            try await Task.sleep(for: .milliseconds(80))   // throws if the save's task is cancelled
            sent.append(drafts)
        }
        queue.edit(id: "a", text: "first")
        try await Task.sleep(for: .milliseconds(40))       // debounce fired, save in flight
        queue.edit(id: "a", text: "second")
        try await Task.sleep(for: .milliseconds(400))
        #expect(sent.first == ["a": "first"])
        #expect(sent.last == ["a": "second"])
        #expect(queue.errorMessage == nil)
        #expect(queue.pending.isEmpty)
    }

    @Test func cancelledSaveIsNotAnError() async {
        let queue = makeQueue()
        queue.save = { _ in throw CancellationError() }
        queue.edit(id: "a", text: "x")
        await queue.flush()
        #expect(queue.errorMessage == nil)
        #expect(queue.pending == ["a": "x"])
    }
}
