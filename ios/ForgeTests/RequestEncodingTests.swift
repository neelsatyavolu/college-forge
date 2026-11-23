import Foundation
import Testing
@testable import Forge

@Suite("Request bodies")
struct RequestEncodingTests {
    private func object(_ value: some Encodable) throws -> [String: Any] {
        try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any])
    }

    @Test func applicationActionsUseServerNames() throws {
        let update = try object(ApplicationAction.update(id: "app-1", edit: ApplicationEdit(status: .admitted, round: .ed)))
        #expect(update["action"] as? String == "update")
        #expect(update["id"] as? String == "app-1")
        let edit = try #require(update["edit"] as? [String: Any])
        #expect(edit["status"] as? String == "admitted")
        #expect(edit["round"] as? String == "ED")
        #expect(edit["notes"] == nil)

        let add = try object(ApplicationAction.add(collegeId: "rice", slug: "rice", edit: ApplicationEdit(deadline: "2026-11-01")))
        #expect(add["action"] as? String == "add")
        #expect(add["collegeId"] as? String == "rice")
        #expect(add["deadline"] as? String == "2026-11-01")
        #expect(add["name"] == nil)

        #expect(try object(ApplicationAction.forgetLogin(id: "x"))["action"] as? String == "forget-login")
        #expect(try object(ApplicationAction.importCollegeApps(email: "a", password: "b"))["action"] as? String == "import-collegeapps")
        let follow = try object(ApplicationAction.followUpSet(id: "x", followUpId: "f", done: true))
        #expect(follow["action"] as? String == "followup-set")
        #expect(follow["done"] as? Bool == true)
        #expect(follow["remove"] == nil)
        #expect(try object(ApplicationAction.check())["ids"] == nil)
    }

    @Test func patchSendsOnlySetFields() throws {
        let draft = try object(WorkspacePatch.with { $0.essayDraft = .init(id: "ca-1", text: "Hi") })
        #expect(draft.keys.sorted() == ["essayDraft"])

        let clearED = try object(WorkspacePatch.with { $0.ed = .some(nil) })
        #expect(clearED["ed"] is NSNull)
        #expect(try object(WorkspacePatch()).isEmpty)
    }

    @Test func listPrefsSendsExplicitNullAppCount() throws {
        let prefs = try object(ListPrefs())
        #expect(prefs["appCount"] is NSNull)
    }
}
