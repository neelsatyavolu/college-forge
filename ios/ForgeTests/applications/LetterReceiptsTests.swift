import Foundation
import Testing
@testable import Forge

/// Mirrors tests/recommenders.test.cjs so the iOS port matches public/hub/recommenders.js.
struct LetterReceiptsTests {
    private func item(_ text: String, _ done: Bool) -> PortalItem {
        PortalItem(item: text, status: done ? "Received" : "Not received", date: "", done: done, optional: false)
    }

    private func app(_ id: String, _ checklist: [PortalItem]?) -> TrackedApplication {
        var app = PreviewData.app(id: id, name: "School \(id)", status: .submitted, round: .rd, deadline: "2027-01-04")
        app.portal = checklist.map { PortalSnapshot(checkedAt: 0, ok: true, error: "", statusText: "", update: "", checklist: $0) }
        return app
    }

    @Test func matchesByNameThenByType() {
        let apps = [
            app("a1", [item("Teacher Evaluation - Ms. Lee", true), item("Teacher Evaluation - Mr. Park", false), item("Mid-Year Report", false)]),
            app("a2", [item("Teacher Evaluation", true), item("Teacher Evaluation", false)]),
            app("a3", [item("Application form", true)]),
            app("a4", nil),
        ]
        let lee = Recommendation(id: "r1", name: "Ms. Lee", type: .teacher, status: .asked, schools: ["a1", "a2", "a3", "a4", "gone"])
        let park = Recommendation(id: "r2", name: "Mr. Park", type: .teacher, status: .asked, schools: ["a1"])
        let r = Dictionary(uniqueKeysWithValues: LetterReceipts.receipts(for: lee, apps: apps, others: [lee, park]).map { ($0.appId, $0) })
        #expect(r.count == 4)
        #expect(r["a1"]?.state == .received)
        #expect(r["a1"]?.byType == false)
        #expect(r["a2"]?.state == .unclear, "one of two unnamed teacher letters in")
        #expect(r["a2"]?.byType == true)
        #expect(r["a2"]?.total == 2)
        #expect(r["a3"]?.state == .noPortalData)
        #expect(r["a4"]?.state == .noPortalData)
        #expect(LetterReceipts.receipts(for: park, apps: apps, others: [lee, park]).first?.state == .missing)
    }

    @Test func noFalseNameMatches() {
        #expect(LetterReceipts.lastName("Ms. Lee") == "lee")
        #expect(LetterReceipts.lastName("Dr.") == "")
        let apps = [app("x", [item("Teacher Evaluation - Leeds", true), item("Teacher Evaluation - Smith", false)])]
        let lee = Recommendation(id: "r1", name: "Ms. Lee", type: .teacher, status: .asked, schools: ["x"])
        #expect(LetterReceipts.receipts(for: lee, apps: apps, others: []).first?.byType == true)
    }

    @Test func emailCheckMatchesServer() {
        #expect(LetterReceipts.isEmail("t@school.org"))
        #expect(!LetterReceipts.isEmail("not-an-email"))
        #expect(!LetterReceipts.isEmail("a b@school.org"))
    }

    @Test func decodesNewFields() throws {
        let json = #"{"id":"r1","name":"Ms. Lee","type":"teacher","status":"asked","askedAt":"2026-10-01","email":"t@school.org","schools":["a1"],"thankYouSent":true,"bragSheet":"Robotics"}"#
        let rec = try JSONDecoder().decode(Recommendation.self, from: Data(json.utf8))
        #expect(rec.schools == ["a1"])
        #expect(rec.thankYouSent == true)
        #expect(rec.askedAt == "2026-10-01")
        let old = try JSONDecoder().decode(Recommendation.self, from: Data(#"{"id":"r","name":"X","type":"teacher","status":"asked"}"#.utf8))
        #expect(old.schools == nil)
    }
}
