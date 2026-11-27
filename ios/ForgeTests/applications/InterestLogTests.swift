import Foundation
import Testing
@testable import Forge

@Suite("Interest log")
struct InterestLogTests {
    private func object(_ value: some Encodable) throws -> [String: Any] {
        try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any])
    }

    @Test func applicationDecodesInterestAndSignal() throws {
        let json = """
        {"id":"a1","name":"Tulane University","status":"planning","updatedAt":1,
         "interest":[{"id":"e1","kind":"interview","date":"2026-12-05","time":"15:30","who":"Alum","thankYouSent":false,"done":false,"createdAt":2},
                     {"id":"e2","kind":"campus_tour","date":"2026-10-01","done":true,"createdAt":3},
                     "junk"],
         "interestSignal":{"counts":"important","interview":"not_offered","countsFact":{"text":"Important (CDS 2025-26 C7)","sourceUrl":"https://tulane.edu/cds"},"logged":2,"thankYouOwed":0,"nudge":"Counts interest as important; nothing logged yet."}}
        """
        let app = try JSONDecoder().decode(TrackedApplication.self, from: Data(json.utf8))
        #expect(app.interest.map(\.id) == ["e1", "e2"])
        #expect(app.interest[0].isInterview)
        #expect(app.interest[0].time == "15:30")
        #expect(app.interest[1].kind.rawValue == "campus_tour")
        #expect(app.interest[1].kind.label == "Other")
        #expect(app.interestSignal?.countsLabel == "Interest counts a lot")
        #expect(app.interestSignal?.interviewLabel == "No interviews")
        #expect(app.interestSignal?.countsFact?.sourceUrl == "https://tulane.edu/cds")
        #expect(app.interestSignal?.nudge != nil)
    }

    @Test func olderRepliesWithoutInterestStillDecode() throws {
        let app = try JSONDecoder().decode(TrackedApplication.self, from: Data(#"{"id":"a1","name":"Rice","status":"submitted","updatedAt":1}"#.utf8))
        #expect(app.interest.isEmpty)
        #expect(app.interestSignal == nil)
    }

    @Test func thankYouOwedOnlyForDoneInterviews() {
        let done = InterestEvent(id: "x", kind: .interview, date: "2026-11-01", thankYouSent: false, done: true, createdAt: 0)
        #expect(done.owesThankYou)
        #expect(!InterestEvent(id: "y", kind: .interview, date: "2026-12-01", thankYouSent: false, done: false, createdAt: 0).owesThankYou)
        #expect(!InterestEvent(id: "z", kind: .visit, date: "2026-11-01", done: true, createdAt: 0).owesThankYou)
    }

    @Test func actionsUseServerNames() throws {
        let add = try object(ApplicationAction.interestAdd(id: "a1", edit: InterestEdit(kind: .interview, date: "2026-12-05", time: "15:30")))
        #expect(add["action"] as? String == "interest-add")
        #expect(add["kind"] as? String == "interview")
        #expect(add["date"] as? String == "2026-12-05")
        #expect(add["time"] as? String == "15:30")
        #expect(add["who"] == nil)
        let set = try object(ApplicationAction.interestSet(id: "a1", interestId: "e1", edit: InterestEdit(thankYouSent: true)))
        #expect(set["action"] as? String == "interest-set")
        #expect(set["interestId"] as? String == "e1")
        #expect(set["thankYouSent"] as? Bool == true)
        #expect(set["remove"] == nil)
    }

    @Test func timesFormatBothWays() throws {
        #expect(InterestTime.display("15:30") == "3:30 PM")
        #expect(InterestTime.display("00:05") == "12:05 AM")
        #expect(InterestTime.display("12:00") == "12:00 PM")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let date = try #require(calendar.date(from: DateComponents(year: 2026, month: 12, day: 5, hour: 9, minute: 7)))
        #expect(InterestTime.string(date, calendar: calendar) == "09:07")
    }
}
