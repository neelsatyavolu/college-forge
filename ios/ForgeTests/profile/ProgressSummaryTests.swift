import Foundation
import Testing
@testable import Forge

@Suite("Progress overview")
struct ProgressSummaryTests {
    private func app(_ id: String, _ status: AppStatus, deadline: String = "", name: String? = nil) -> TrackedApplication {
        PreviewData.app(id: id, name: name ?? "School \(id)", status: status, round: .rd, deadline: deadline)
    }

    @Test func countsAndNextDue() {
        let apps = [
            app("a", .inProgress, deadline: "2026-12-01"),
            app("b", .planning, deadline: "2026-12-01"),
            app("c", .planning, deadline: "2026-11-01"), // passed
            app("d", .submitted),
            app("e", .withdrawn),
        ]
        let summary = ProgressSummary(tracker: TrackerView(revision: 1, autocheck: true, emails: true, flags: [], apps: apps), today: "2026-11-23")
        #expect(summary.total == 5)
        #expect(summary.submitted == 1)
        #expect(summary.nextUp.map(\.id) == ["c", "a", "b"])
        #expect(summary.nextDue?.date == "2026-12-01")
        #expect(summary.nextDue?.count == 2)
        #expect(summary.waiting.map(\.id) == ["d"])
    }

    @Test func attentionPutsHiddenDecisionsFirst() {
        var missing = app("m", .submitted, deadline: "2026-11-01")
        missing.missing = ["Transcript"]
        var hidden = app("h", .submitted, deadline: "2027-01-01")
        hidden.decision.state = .hidden
        var followUp = app("f", .submitted)
        followUp.followUps = [FollowUp(id: "x", text: "Send scores", due: "2026-12-05", done: false, createdAt: 0)]
        let quiet = app("q", .submitted)
        let tracker = TrackerView(revision: 1, autocheck: true, emails: true, flags: [], apps: [missing, hidden, followUp, quiet])
        let summary = ProgressSummary(tracker: tracker, today: "2026-11-23")
        #expect(summary.attention.map(\.id) == ["h", "m", "f"])
        #expect(summary.waiting.map(\.id) == ["q"])
        #expect(summary.followUps.map(\.appID) == ["f"])
        #expect(summary.decided == 1)
    }

    @Test func attentionReasons() {
        var a = app("a", .submitted)
        a.missing = ["Fee"]
        a.lastFailure = PortalFailure(at: 0, error: "Login failed")
        #expect(ProgressAttention.reasons(for: a) == [.missing, .check])
        #expect(ProgressAttention.missing.text(for: a) == "1 missing")
        var admitted = app("b", .admitted)
        admitted.missing = ["Final transcript"]
        #expect(ProgressAttention.reasons(for: admitted).isEmpty)
    }

    @Test func headline() {
        let tracker = TrackerView(revision: 1, autocheck: true, emails: true, flags: [],
                                  apps: [app("a", .submitted), app("b", .inProgress, deadline: "2099-01-05")])
        let line = ProgressSummary(tracker: tracker, today: "2026-11-23").headline(flags: 2)
        #expect(line.hasPrefix("1/2 submitted · 1 due "))
        #expect(line.hasSuffix(" · 2 flags"))
    }

    @Test func whenText() {
        let now = ForgeDates.day("2026-11-23")!
        let soon = ProgressWhen.text(for: app("a", .inProgress, deadline: "2026-11-26"), now: now)
        #expect(soon.text == "Nov 26 · in 3d")
        #expect(soon.isSoon)
        let late = ProgressWhen.text(for: app("b", .inProgress, deadline: "2026-11-20"), now: now)
        #expect(late.isLate)
        #expect(ProgressWhen.text(for: app("c", .planning), now: now).text == "No deadline set")
    }
}
