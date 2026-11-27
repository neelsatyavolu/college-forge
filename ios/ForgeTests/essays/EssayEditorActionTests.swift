import Foundation
import Testing
@testable import Forge

@MainActor
@Suite("Essay editor actions")
struct EssayEditorActionTests {
    @Test func replacementWaitsForTheEarlierDraftAndItsOwnSave() async {
        let queue = EssayDraftQueue(key: "synthetic-workspace", journal: nil, debounce: .seconds(60))
        var saved: [String] = []
        var resumeSave: CheckedContinuation<Void, Never>?
        queue.save = { drafts in
            if saved.isEmpty {
                await withCheckedContinuation { resumeSave = $0 }
            }
            saved.append(drafts["essay"]!)
        }

        queue.edit(id: "essay", text: "Earlier draft")
        let earlier = Task { await queue.flush() }
        while resumeSave == nil { await Task.yield() }
        queue.edit(id: "essay", text: "Suggested draft")
        var replacementStarted = false
        let replacement = Task {
            replacementStarted = true
            await queue.flush()
            return saved
        }
        while !replacementStarted { await Task.yield() }
        resumeSave?.resume()
        let confirmed = await replacement.value
        await earlier.value
        #expect(confirmed == ["Earlier draft", "Suggested draft"])
        #expect(queue.state == .saved)
    }
}
