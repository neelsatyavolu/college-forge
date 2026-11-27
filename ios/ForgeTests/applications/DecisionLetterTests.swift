import Foundation
import Testing
@testable import Forge

@Suite("Decision letters")
struct DecisionLetterTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    @Test func revealedApplicationDecodesResultLetterAndAwards() throws {
        let app = try decode(TrackedApplication.self, """
        {"id":"a1","name":"Purdue University","status":"admitted","decision":{"state":"revealed","portalText":"","result":"admitted"},
         "letter":{"id":"abc","kind":"html","capturedAt":1700000000000,"result":"admitted",
                   "awards":[{"name":"Presidential Scholarship","amount":"$25,000","period":"per year"}]},
         "letterHistory":[{"id":"old","kind":"text","capturedAt":1,"result":"deferred","awards":[]}]}
        """)
        #expect(app.decision.result == .admitted)
        #expect(app.letter?.kind == .html)
        #expect(app.letter?.awards.first?.amountText == "$25,000 per year")
        #expect(app.letterHistory.first?.result == .deferred)
    }

    @Test func olderServerAndUnclearResultDecodeToNil() throws {
        let old = try decode(TrackedApplication.self, #"{"id":"a1","name":"Rice","status":"complete","decision":{"state":"hidden","portalText":""}}"#)
        #expect(old.decision.result == nil)
        #expect(old.letter == nil)
        #expect(old.letterHistory.isEmpty)
        let unclear = try decode(DecisionView.self, #"{"state":"revealed","portalText":"Decision Released","result":""}"#)
        #expect(unclear.result == nil)
        // An explicit "unclear" never falls back to guessing; an older server without `result` does.
        let wishful = try decode(DecisionView.self, #"{"state":"revealed","portalText":"Congratulations on submitting","result":""}"#)
        #expect(DecisionLogic.outcome(wishful) == nil)
        let legacy = try decode(DecisionView.self, #"{"state":"revealed","portalText":"Admitted"}"#)
        #expect(DecisionLogic.outcome(legacy) == .admitted)
    }

    @Test func letterBodyDecodesPDF() throws {
        let pdf = Data("%PDF-1.7".utf8).base64EncodedString()
        let letter = try decode(DecisionLetter.self, #"{"id":"x","kind":"pdf","text":"Admitted","pdfBase64":"\#(pdf)","capturedAt":5,"result":"admitted","awards":[]}"#)
        #expect(letter.kind == .pdf)
        #expect(letter.pdfData == Data("%PDF-1.7".utf8))
        #expect(letter.html == nil)
    }

    @Test func letterActionsUseServerNames() throws {
        let read = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(ApplicationAction.letter(id: "a1"))) as? [String: Any])
        #expect(read["action"] as? String == "letter")
        #expect(read["letterId"] == nil)
        let award = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(ApplicationAction.awardAdd(id: "a1", index: 0, letterId: "abc"))) as? [String: Any])
        #expect(award["action"] as? String == "award-add")
        #expect(award["index"] as? Int == 0)
        #expect(award["letterId"] as? String == "abc")
    }

    @Test func deferralAndWaitlistGetANextStepNote() {
        #expect(DecisionLogic.resultNote(.deferred)?.contains("Regular Decision") == true)
        #expect(DecisionLogic.resultNote(.waitlisted) != nil)
        #expect(DecisionLogic.resultNote(.admitted) == nil)
        #expect(DecisionLogic.resultNote(nil) == nil)
    }
}
