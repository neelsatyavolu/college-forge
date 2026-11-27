import Foundation
import Testing
@testable import Forge

@Suite("Aid decoding")
struct AidDecodingTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    @Test func aidPlanDecodesServerShape() throws {
        let json = """
        {"data":{"schools":[{"appId":"a1","name":"Test College","slug":"test-college","ignoreAid":false,"css":"required","idoc":true,
        "cssNote":"CSS Profile and IDOC required","cssSource":"https://aid.example.edu","cssCheckedAt":"2026-11-01",
        "deadlines":[{"plan":"CSS Profile (ED)","date":"2026-11-15","kind":"aid"}],"followUps":[{"id":"f1","text":"Send fee waiver","due":""}],
        "todos":[{"text":"Submit the CSS Profile for Test College","due":"2026-11-15"}]},
        {"appId":"a2","name":"Other College","css":"something_new","idoc":"no"}],
        "totals":{"cssSchools":1,"idocSchools":1,"scholarshipsWon":2,"wonAmount":"1500"}}}
        """
        let plan = try decode(DataEnvelope<AidPlan>.self, json).data
        #expect(plan.schools.count == 2)
        #expect(plan.schools[0].css == .required)
        #expect(plan.schools[0].idoc)
        #expect(plan.schools[0].todos.first?.due == "2026-11-15")
        #expect(plan.schools[0].deadlines.first?.kind == "aid")
        #expect(plan.schools[1].css.rawValue == "something_new")
        #expect(plan.schools[1].css.label == "Check aid page")
        #expect(plan.totals.wonAmount == 1500)
    }

    @Test func financialAidDefaultsIdocToNotApplicable() throws {
        let old = try decode(FinancialAid.self, #"{"fafsaStatus":"submitted","cssStatus":"in_progress"}"#)
        #expect(old.idocStatus == .notApplicable)
        let new = try decode(FinancialAid.self, #"{"fafsaStatus":"submitted","cssStatus":"submitted","idocStatus":"in_progress"}"#)
        #expect(new.idocStatus == .inProgress)
    }

    @Test func scholarshipCarriesSchoolLinkAndOffer() throws {
        let s = try decode(Scholarship.self, #"{"id":"s1","name":"Dean award","status":"won","kind":"school","slug":"test-college"}"#)
        #expect(s.kind == "school")
        #expect(s.slug == "test-college")
        let offer = try decode(AidOffer.self, #"{"costOfAttendance":85000,"grants":"60000","updatedAt":5}"#)
        #expect(offer.costOfAttendance == 85000)
        #expect(offer.grants == 60000)
        #expect(offer.loans == nil)
    }
}
