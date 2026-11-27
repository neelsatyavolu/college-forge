import Foundation
import Testing
@testable import Forge

@Suite("Portal checklist order")
struct PortalChecklistOrderTests {
    private func item(_ name: String, done: Bool = false, optional: Bool = false) -> PortalItem {
        PortalItem(item: name, status: done ? "Received" : "Not received", date: "", done: done, optional: optional)
    }

    @Test func missingItemsLeadInPortalOrder() {
        let checklist = [item("Transcript", done: true), item("Counselor rec"), item("Interview", optional: true), item("Mid-year report")]
        let rows = PortalChecklistOrder.rows(checklist: checklist, missing: ["Mid-year report", "Counselor rec"], decisionHidden: false)
        #expect(rows.map(\.item.item) == ["Counselor rec", "Mid-year report", "Transcript", "Interview"])
        #expect(rows.map(\.missing) == [true, true, false, false])
    }

    @Test func nothingMissingKeepsPortalOrder() {
        let checklist = [item("Transcript", done: true), item("Interview", optional: true)]
        let rows = PortalChecklistOrder.rows(checklist: checklist, missing: [], decisionHidden: false)
        #expect(rows.map(\.item.item) == ["Transcript", "Interview"])
        #expect(rows.allSatisfy { !$0.missing })
    }

    @Test func hiddenDecisionShowsOnlyMissingNames() {
        // The server sends an empty checklist while a decision is unopened; the missing names still show.
        let rows = PortalChecklistOrder.rows(checklist: [], missing: ["Counselor rec"], decisionHidden: true)
        #expect(rows.map(\.item.item) == ["Counselor rec"])
        #expect(rows.map(\.missing) == [true])
        #expect(rows.first?.item.status == "")
        #expect(PortalChecklistOrder.rows(checklist: [item("Transcript")], missing: [], decisionHidden: true).isEmpty)
    }

    @Test func optionalTwinOfMissingItemIsNotMarkedMissing() {
        let checklist = [item("Teacher evaluation", optional: true), item("Teacher evaluation")]
        let rows = PortalChecklistOrder.rows(checklist: checklist, missing: ["Teacher evaluation"], decisionHidden: false)
        #expect(rows.map(\.missing) == [true, false])
        #expect(rows.first?.item.optional == false)
    }
}
