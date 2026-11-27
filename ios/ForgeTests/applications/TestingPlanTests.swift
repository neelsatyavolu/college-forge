import Foundation
import Testing
@testable import Forge

@Suite("Testing plan")
struct TestingPlanTests {
    @Test func decodesTheServerView() throws {
        let json = """
        {"policy":{"kind":"required","selfReport":true,"superscore":null,"text":"Test-required","sourceUrl":"https://admissions.yale.edu/standardized-testing"},
         "recommendation":{"advice":"send","label":"Send","reason":"Test-required.","sourceUrl":"https://admissions.yale.edu/standardized-testing"},
         "choice":{"plan":"send","method":"official"},"hasAps":true,"needsScoreSend":true}
        """
        let plan = try JSONDecoder().decode(TestingPlanView.self, from: Data(json.utf8))
        #expect(plan.policy.kind == "required")
        #expect(plan.policy.selfReport == true)
        #expect(plan.policy.superscore == nil)
        #expect(plan.policy.summary == "Test-required · self-reported scores accepted")
        #expect(plan.choice.plan == .send)
        #expect(plan.choice.method == .official)
        #expect(plan.choice.officialSent == nil)
        #expect(plan.needsScoreSend)
    }

    @Test func toleratesMissingAndUnknownFields() throws {
        let plan = try JSONDecoder().decode(TestingPlanView.self, from: Data(#"{"choice":{"plan":"later"}}"#.utf8))
        #expect(plan.policy.kind == "unknown")
        #expect(plan.choice.plan == .undecided)
        #expect(!plan.hasAps)
    }

    @Test func editEncodesOnlySetFields() throws {
        let body = try JSONEncoder().encode(ApplicationAction.update(id: "a1", edit: ApplicationEdit(testing: TestingEdit(method: ""))))
        let object = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
        let edit = try #require(object["edit"] as? [String: Any])
        let testing = try #require(edit["testing"] as? [String: Any])
        #expect(testing.keys.sorted() == ["method"])
        #expect(testing["method"] as? String == "")
        #expect(edit["status"] == nil)
    }

    @Test func choiceMergesLikeTheServer() {
        let start = TestingChoice(plan: .send, method: .official)
        let sent = start.applying(TestingEdit(officialSent: "2026-11-20"))
        #expect(sent.officialSent == "2026-11-20")
        let cleared = sent.applying(TestingEdit(method: "", officialSent: ""))
        #expect(cleared.method == nil)
        #expect(cleared.officialSent == nil)
        #expect(cleared.plan == .send)
    }
}
