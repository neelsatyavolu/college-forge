import Foundation
import Testing
@testable import Forge

struct EssayMetadataTests {
    @Test func patchBodiesChangeOnlyTheSelectedEssay() throws {
        func body(_ patch: EssaysMetadataPatch) throws -> JSONValue {
            try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(patch))
        }
        #expect(try body(.final(id: "sample", marked: true)) == ["essayStatus": ["sample": "final"]])
        #expect(try body(.final(id: "sample", marked: false)) == ["essayStatus": ["sample": "draft"]])
        #expect(try body(.dismiss(id: "sample")) == ["essaySuggestions": ["sample": .null]])
    }

    @Test func readsMetadataFromBareWorkspaceAndPatchEnvelope() throws {
        let json = """
        {"revision":3,"draftStorageKey":"sample","essayStatus":{"a":"final"},
         "essaySuggestions":{"a":{"text":"Sample revision","createdAt":1}},
         "essays":{"commonApp":[{"id":"a","required":false}],
                  "supplements":{"sample-school":[{"id":"b","chooseGroup":"pick","choose":1}]}}}
        """
        let snapshot = try JSONDecoder().decode(EssaysMetadataSnapshot.self, from: Data(json.utf8))
        #expect(snapshot.status["a"] == "final")
        #expect(snapshot.rules["a"]?.required == false)
        #expect(snapshot.rules["b"]?.choose == 1)
        let reply = Data("{\"data\":\(json)}".utf8)
        let patched = try JSONDecoder().decode(DataEnvelope<EssaysMetadataSnapshot>.self, from: reply)
        #expect(patched.data.suggestions == ["a": "Sample revision"])
    }
}
