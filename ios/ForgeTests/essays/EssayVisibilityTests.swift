import Foundation
import Testing
@testable import Forge

@Suite("Essay visibility")
struct EssayVisibilityTests {
    private func object(_ value: some Encodable) throws -> [String: Any] {
        try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any])
    }

    @Test func patchSendsHideShowAndClearAsTheServerExpects() throws {
        let hide = try object(WorkspacePatch.with { $0.essayHidden = ["a": Optional(true), "b": Optional<Bool>.none] })
        let map = try #require(hide["essayHidden"] as? [String: Any])
        #expect(map["a"] as? Bool == true)
        #expect(map["b"] is NSNull)
        #expect(try object(WorkspacePatch.with { $0.commonAppPrompt = "ca-ps-2" })["commonAppPrompt"] as? String == "ca-ps-2")
        #expect(try object(WorkspacePatch.with { $0.commonAppPrompt = .some(nil) })["commonAppPrompt"] is NSNull)
        #expect(try object(WorkspacePatch()).isEmpty)
    }

    @Test func workspaceDecodesTheFieldsAndToleratesTheirAbsence() throws {
        let with = try JSONDecoder().decode(Workspace.self, from: Data(#"{"essayHidden":{"x":true},"commonAppPrompt":"ca-ps-3"}"#.utf8))
        #expect(with.essayHidden == ["x": true])
        #expect(with.commonAppPrompt == "ca-ps-3")
        let without = try JSONDecoder().decode(Workspace.self, from: Data("{}".utf8))
        #expect(without.essayHidden.isEmpty)
        #expect(without.commonAppPrompt == nil)
    }

    @Test func catalogDropsUnchosenPromptsAndListsHiddenOnesApart() throws {
        var essays = EssaySet()
        essays.commonApp = [Essay(id: "ca-ps-1", label: "One", prompt: "p"), Essay(id: "ca-ps-2", label: "Two", prompt: "p"),
                            Essay(id: "ca-additional-info", label: "Additional", prompt: "p")]
        let groups = EssayCatalog.groups(colleges: [], essays: essays, hidden: ["ca-additional-info": true], commonAppPrompt: "ca-ps-2")
        let common = try #require(groups.first)
        #expect(common.essays.map(\.id) == ["ca-ps-2"])
        #expect(common.hiddenEssays.map(\.id) == ["ca-additional-info"])
        #expect(EssayCatalog.groups(colleges: [], essays: essays).first?.essays.count == 3)
    }
}
