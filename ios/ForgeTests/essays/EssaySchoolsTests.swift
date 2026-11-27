import Foundation
import Testing
@testable import Forge

@Suite("Essay schools")
struct EssaySchoolsTests {
    private func object(_ value: some Encodable) throws -> [String: Any] {
        try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any])
    }

    private let colleges = [
        College(slug: "rice-university", name: "Rice"),
        College(slug: "duke-university", name: "Duke"),
        College(slug: "university-of-california-davis", name: "University of California-Davis"),
        College(slug: "ucla", name: "UCLA"),
    ]

    private var essays: EssaySet {
        var set = EssaySet()
        set.commonApp = [Essay(id: "ca-ps-1", label: "One", prompt: "p")]
        set.supplements = [
            "rice-university": [Essay(id: "rice-1", label: "Why Rice", prompt: "p")],
            "duke-university": [Essay(id: "duke-1", label: "Why Duke", prompt: "p")],
            "uc-application": [Essay(id: "uc-piq-1", label: "PIQ 1", prompt: "p")],
        ]
        return set
    }

    @Test func catalogDropsSchoolsTheStudentIsNotWritingFor() {
        let all = EssayCatalog.groups(colleges: colleges, essays: essays).map(\.key)
        #expect(Set(all) == ["common", "rice-university", "duke-university", "uc-application"])
        let some = EssayCatalog.groups(colleges: colleges, essays: essays,
                                       essaySchools: ["rice-university": false, "uc-application": false, "common": false])
        #expect(Set(some.map(\.key)) == ["common", "duke-university"], "the Common App can't be turned off")
        #expect(EssayCatalog.items(in: some).contains { $0.id == "rice-1" } == false)
    }

    @Test func schoolRowsGroupUCCampusesAndMarkOptedOutSchools() {
        let rows = EssayCatalog.schools(colleges: colleges, essaySchools: ["duke-university": false])
        #expect(rows.map(\.key) == ["rice-university", "duke-university", "uc-application"])
        #expect(rows.map(\.writing) == [true, false, true])
        #expect(rows[2].subtitle.contains("UCLA"))
        #expect(EssayCatalog.groupKey(for: College(slug: "ucla", name: "UCLA")) == "uc-application")
    }

    @Test func twoListRowsOnOneSlugGiveOneRow() {
        let rows = EssayCatalog.schools(colleges: [College(slug: "rice-university", name: "Rice"), College(slug: "rice-university", name: "Rice University")],
                                        essaySchools: [:])
        #expect(rows.map(\.key) == ["rice-university"])
    }

    @Test func sheetSendsOnlyChangedSchools() {
        let rows = EssayCatalog.schools(colleges: colleges, essaySchools: ["duke-university": false])
        #expect(EssaySchoolsSheet.changes(rows: rows, picked: [:]).isEmpty)
        let changes = EssaySchoolsSheet.changes(rows: rows, picked: ["rice-university": false, "duke-university": true, "uc-application": true])
        #expect(changes == ["rice-university": false, "duke-university": true])
    }

    @Test func patchAndWorkspaceUseTheServerShape() throws {
        let body = try object(WorkspacePatch.with { $0.essaySchools = ["a": Optional(false), "b": Optional<Bool>.none] })
        let map = try #require(body["essaySchools"] as? [String: Any])
        #expect(map["a"] as? Bool == false)
        #expect(map["b"] is NSNull)
        #expect(try object(WorkspacePatch())["essaySchools"] == nil)
        let ws = try JSONDecoder().decode(Workspace.self, from: Data(#"{"essaySchools":{"rice-university":false}}"#.utf8))
        #expect(ws.essaySchools == ["rice-university": false])
        #expect(try JSONDecoder().decode(Workspace.self, from: Data("{}".utf8)).essaySchools.isEmpty)
    }
}
