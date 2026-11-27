import Foundation
import Testing
@testable import Forge

/// Synthetic data for the home-screen widget logic.
private enum W {
    /// Noon on 2026-12-01, local time.
    static let now = ForgeDates.day("2026-12-01")!

    static func app(
        _ id: String, stage: String = "working", deadline: String = "", decisionDate: String = "",
        posted: Bool = false, missing: [String] = [], followUps: [WidgetFollowUp] = []
    ) -> WidgetApp {
        WidgetApp(id: id, name: "School \(id)", stage: stage, statusLabel: "", round: "RD", deadline: deadline,
                  decisionDate: decisionDate, decisionEstimated: false, decisionPosted: posted, missing: missing, followUps: followUps)
    }

    static func snapshot(_ apps: [WidgetApp], flags: [String] = [], dates: [WidgetDate] = []) -> WidgetSnapshot {
        WidgetSnapshot(firstName: "Sam", apps: apps, flags: flags, dates: dates)
    }
}

@Suite("Widget agenda")
struct WidgetAgendaTests {
    @Test func postedDecisionComesFirst() {
        let s = W.snapshot([
            W.app("a", deadline: "2026-12-01"),
            W.app("b", stage: "waiting", posted: true),
        ])
        let items = WidgetAgenda.upNext(s, now: W.now)
        #expect(items.first?.kind == .decisionPosted)
        #expect(items.first?.applicationID == "b")
        #expect(items.first?.headline(now: W.now) == "Decision posted")
        #expect(items[1].kind == .deadline)
    }

    @Test func postedDecisionHidesEverythingElseAboutThatSchool() {
        let s = W.snapshot([W.app("b", stage: "waiting", decisionDate: "2027-03-01", posted: true, missing: ["Transcript"])])
        #expect(WidgetAgenda.upNext(s, now: W.now).map(\.kind) == [.decisionPosted])
    }

    @Test func tiersOrderUrgency() {
        let s = W.snapshot([
            W.app("later", deadline: "2027-01-15"),
            W.app("soon", deadline: "2026-12-10"),
            W.app("now", deadline: "2026-12-03"),
            W.app("sent", stage: "waiting", decisionDate: "2027-03-20", missing: ["Mid-year report"]),
        ], flags: ["Two schools need the CSS Profile"])
        let ids = WidgetAgenda.upNext(s, now: W.now).map(\.id)
        #expect(ids == ["d-now", "d-soon", "m-sent", "flag-0", "d-later", "r-sent"])
    }

    @Test func oldDeadlinesDropAndRecentOnesAskIfSent() {
        let s = W.snapshot([W.app("old", deadline: "2026-11-20"), W.app("recent", deadline: "2026-11-29")])
        let items = WidgetAgenda.upNext(s, now: W.now)
        #expect(items.map(\.id) == ["d-recent"])
        #expect(items[0].detail == "Deadline passed. Submitted?")
        #expect(items[0].headline(now: W.now) == "Due 2 days ago")
    }

    @Test func followUpsRankByDueDate() {
        let s = W.snapshot([W.app("a", stage: "waiting", followUps: [
            WidgetFollowUp(text: "Send scores", due: "2026-12-02"),
            WidgetFollowUp(text: "Thank-you note", due: ""),
        ])])
        let items = WidgetAgenda.upNext(s, now: W.now)
        #expect(items.map(\.title) == ["Send scores", "Thank-you note"])
        #expect(items[0].tier == 1)
        #expect(items[0].headline(now: W.now) == "Due tomorrow")
        #expect(items[1].headline(now: W.now) == "To do")
    }

    @Test func upcomingDatesAreSoonestFirstAndSkipThePast() {
        let s = W.snapshot(
            [W.app("a", deadline: "2027-01-01"), W.app("b", stage: "waiting", decisionDate: "2026-12-15")],
            dates: [WidgetDate(date: "2026-12-05", label: "SAT", detail: ""), WidgetDate(date: "2026-11-01", label: "Old", detail: "")]
        )
        #expect(WidgetAgenda.upcomingDates(s, now: W.now).map(\.title) == ["SAT", "School b", "School a"])
        #expect(WidgetAgenda.nextDeadline(s, now: W.now)?.applicationID == "a")
    }

    @Test func tallyCountsPostedApartFromOutcomes() {
        let s = W.snapshot([
            W.app("1"), W.app("2", stage: "waiting"), W.app("3", stage: "admitted"),
            W.app("4", stage: "denied"), W.app("5", stage: "waiting", posted: true), W.app("6", stage: "closed"),
        ])
        let t = WidgetAgenda.tally(s)
        #expect(t == WidgetAgenda.Tally(total: 5, submitted: 4, working: 1, waiting: 1, admitted: 1, denied: 1, posted: 1))
    }

    @Test func whenSwitchesToADatePastTwoWeeks() {
        #expect(WidgetAgenda.when("2026-12-01", now: W.now) == "today")
        #expect(WidgetAgenda.when("2026-12-15", now: W.now) == "in 14 days")
        #expect(WidgetAgenda.when("2026-12-20", now: W.now) == ForgeDates.short("2026-12-20", now: W.now))
    }
}

@Suite("Widget snapshot")
@MainActor
struct WidgetSnapshotTests {
    @Test func hiddenDecisionLeavesNoOutcomeInTheSnapshot() {
        var app = AppFixture.make("x", status: .denied, decision: .hidden)
        app.followUps = [
            FollowUp(id: "f1", text: "Open", due: "", done: false, createdAt: 0),
            FollowUp(id: "f2", text: "Done", due: "", done: true, createdAt: 0),
        ]
        let tracker = TrackerView(revision: 1, autocheck: true, emails: true, flags: [], apps: [app])
        var workspace = Workspace.empty
        workspace.applicant.name = "Sam Lee"
        workspace.criticalDates = [CriticalDate(date: "2027-01-05", label: "Mid-year", detail: ""), CriticalDate(date: "Jan", label: "Bad", detail: "")]

        let snapshot = WidgetSync.snapshot(workspace: workspace, tracker: tracker)
        #expect(snapshot.firstName == "Sam")
        #expect(snapshot.apps[0].decisionPosted)
        #expect(snapshot.apps[0].stage == "waiting")
        #expect(snapshot.apps[0].statusLabel == "Decision posted")
        #expect(snapshot.apps[0].followUps.map(\.text) == ["Open"])
        #expect(snapshot.dates.map(\.label) == ["Mid-year"])
        // Nothing in the encoded snapshot names the outcome.
        let json = String(decoding: try! JSONEncoder().encode(snapshot), as: UTF8.self)
        #expect(!json.localizedCaseInsensitiveContains("denied"))
    }
}
