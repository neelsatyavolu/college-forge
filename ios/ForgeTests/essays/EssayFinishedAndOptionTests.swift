import Foundation
import Testing
@testable import Forge

@Suite("Finished schools, essay options and remembered sections")
struct EssayFinishedAndOptionTests {
    private func object(_ value: some Encodable) throws -> [String: Any] {
        try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any])
    }

    private func group(_ key: String, _ essays: [Essay], kind: EssayGroup.Kind = .school) -> EssayGroup {
        EssayGroup(key: key, title: key, kind: kind, essays: essays)
    }

    private func optional(_ id: String) -> Essay {
        var e = Essay(id: id, label: "\(id) (optional)", prompt: "p", limit: 100)
        e.required = false
        return e
    }

    @Test func finishedSchoolsNeedEveryRequiredEssayFinal() {
        let groups = [group("a", [Essay(id: "a1", label: "a1", prompt: "p"), optional("a2")]),
                      group("b", [Essay(id: "b1", label: "b1", prompt: "p")])]
        let progress = EssayWritingProgress(groups: groups, drafts: [:], status: ["a1": "final"], rules: [:])
        #expect(progress.finishedGroups == ["a"], "an optional essay left as a draft doesn't hold a school back")
    }

    @Test func optionalOnlySchoolsFinishOnceEveryShownEssayIsFinal() {
        let groups = [group("nyu", [optional("n1"), optional("n2")]), group("empty", [])]
        #expect(EssayWritingProgress(groups: groups, drafts: [:], status: ["n1": "final"], rules: [:]).finishedGroups.isEmpty)
        let done = EssayWritingProgress(groups: groups, drafts: [:], status: ["n1": "final", "n2": "final"], rules: [:])
        #expect(done.finishedGroups == ["nyu"], "a school with no prompts isn't finished")
    }

    @Test func finishedSchoolsSortAfterOpenOnesAndBeforeRemovedOnes() {
        let groups = [group("common", [Essay(id: "ca-ps-1", label: "PS", prompt: "p")], kind: .common),
                      group("done", [Essay(id: "d1", label: "d1", prompt: "p")]),
                      group("open", [Essay(id: "o1", label: "o1", prompt: "p")]),
                      group("gone", [Essay(id: "g1", label: "g1", prompt: "p")], kind: .orphan),
                      group("open2", [Essay(id: "o2", label: "o2", prompt: "p")])]
        let progress = EssayWritingProgress(groups: groups, drafts: [:], status: ["d1": "final"], rules: [:])
        #expect(progress.sidebarOrder(groups).map(\.key) == ["common", "open", "open2", "done", "gone"])
    }

    @Test func essayDecodesChoiceFieldsLenientlyAndKeepsThemWhenEdited() throws {
        let json = #"{"id":"w","label":"L","prompt":"P","limit":"300","unit":"words","required":false,"chooseGroup":"g","choose":2,"options":["A",3,"B"],"audience":"Honors","source":"official","cycle":null}"#
        let essay = try JSONDecoder().decode(Essay.self, from: Data(json.utf8))
        #expect(essay.limit == 300 && essay.required == false && essay.chooseGroup == "g" && essay.choose == 2)
        #expect(essay.options == ["A", "B"])
        #expect(essay.audience == "Honors")
        let bare = try JSONDecoder().decode(Essay.self, from: Data(#"{"id":"x","options":[],"audience":""}"#.utf8))
        #expect(bare.options == nil && bare.audience == nil && bare.required == nil)

        let item = EssayItem(essay: essay, groupKey: "wake", groupTitle: "Wake")
        var draft = EssayPromptDraft.editing(item)
        draft.label = "New"
        let saved = try object(draft.applied(to: [essay]).essay)
        #expect(saved["options"] as? [String] == ["A", "B"])
        #expect(saved["chooseGroup"] as? String == "g")
        #expect(saved["required"] as? Bool == false)
    }

    @Test func editingUsesTheSavedLimitNotThePickedOptions() {
        var stored = Essay(id: "w", label: "L", prompt: "P", limit: 300)
        stored.options = ["A", "B (150 word limit)"]
        let shown = EssayChoiceRules.withChosenOption(stored, choice: 1)
        let item = EssayItem(essay: shown, groupKey: "wake", groupTitle: "Wake")
        #expect(EssayPromptDraft.editing(item).limit == 150)
        #expect(EssayPromptDraft.editing(item, saved: stored).limit == 300)
    }

    @Test func essayOptionPatchAndWorkspaceField() throws {
        let set = try object(WorkspacePatch.with { $0.essayOption = ["w": 2] })
        #expect((set["essayOption"] as? [String: Any])?["w"] as? Int == 2)
        let clear = try object(WorkspacePatch.with { $0.essayOption = ["w": Optional<Int>.none] })
        #expect((clear["essayOption"] as? [String: Any])?["w"] is NSNull)
        let ws = try JSONDecoder().decode(Workspace.self, from: Data(#"{"essayOption":{"w":1,"bad":"x"}}"#.utf8))
        #expect(ws.essayOption == ["w": 1])
        #expect(try JSONDecoder().decode(Workspace.self, from: Data("{}".utf8)).essayOption.isEmpty)
    }

    @Test func expansionMemoryKeepsTheStudentsChoicesPerWorkspace() throws {
        let defaults = try #require(UserDefaults(suiteName: "essay-expansion-\(UUID().uuidString)"))
        let memory = EssayExpansionMemory(workspaceKey: "ws-1", defaults: defaults)
        #expect(memory.saved().isEmpty)
        memory.save(open: ["rice"], groups: ["common", "rice", "duke"])
        #expect(memory.saved() == ["common": false, "rice": true, "duke": false])
        memory.save(open: ["duke"], groups: ["duke"])
        #expect(memory.saved() == ["common": false, "rice": true, "duke": true], "groups not shown keep their state")
        #expect(EssayExpansionMemory(workspaceKey: "ws-2", defaults: defaults).saved().isEmpty)

        let saved = memory.saved()
        #expect(EssayExpansionMemory.initial(defaults: ["common", "duke", "yale"], saved: saved) == ["rice", "duke", "yale"])
        #expect(EssayExpansionMemory.adding(["rice", "new"], to: [], saved: saved, commonKey: "common") == ["new"],
                "a closed Common App and a school with a saved state stay as the student left them")
        #expect(EssayExpansionMemory.adding([], to: [], saved: [:], commonKey: "common") == ["common"])
    }
}
