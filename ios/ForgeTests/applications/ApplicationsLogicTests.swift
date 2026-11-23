import Foundation
import Testing
@testable import Forge

/// Synthetic applications for the Applications feature tests.
enum AppFixture {
    static func make(
        _ id: String, name: String? = nil, status: AppStatus = .submitted, next: String? = nil,
        deadline: String = "", decision: DecisionState = .none, portalText: String = "",
        missing: [String] = [], portalOK: Bool? = nil, failed: Bool = false
    ) -> TrackedApplication {
        var app = PreviewData.app(id: id, name: name ?? "School \(id)", status: status, round: .rd, deadline: deadline)
        app.nextDate = next.map { KeyDate(date: $0, kind: "Deadline", estimated: false) }
        app.decision = DecisionView(state: decision, portalText: portalText)
        app.missing = missing
        if let portalOK {
            app.portal = PortalSnapshot(checkedAt: 0, ok: portalOK, error: portalOK ? "" : "Login failed", statusText: "", update: "", checklist: [])
        }
        if failed { app.lastFailure = PortalFailure(at: 0, error: "Timed out") }
        return app
    }
}

@Suite("Applications attention and grouping")
struct ApplicationsGroupingTests {
    @Test func attentionMatchesWeb() {
        #expect(AppFixture.make("a", decision: .hidden).attention == [.decision])
        #expect(AppFixture.make("a", missing: ["Transcript"], portalOK: false).attention == [.check, .missing])
        #expect(AppFixture.make("a", failed: true).attention == [.check])
        // After a decision, leftover checklist items and failures don't count.
        #expect(AppFixture.make("a", status: .admitted, missing: ["Final transcript"], failed: true).attention.isEmpty)
        #expect(AppFixture.make("a", status: .denied, decision: .hidden).attention == [.decision])
    }

    @Test func attentionComesFirstThenStages() {
        let apps = [
            AppFixture.make("1", status: .admitted),
            AppFixture.make("2", status: .inProgress, next: "2027-01-01"),
            AppFixture.make("3", missing: ["Essay"]),
            AppFixture.make("4", decision: .hidden),
            AppFixture.make("5", status: .complete),
        ]
        let groups = ApplicationsOrdering.byStatus(apps)
        #expect(groups.map(\.id) == ["attention", "working", "waiting", "admitted"])
        // Decisions outrank missing documents.
        #expect(groups[0].apps.map(\.id) == ["4", "3"])
        #expect(groups[0].isAttention)
    }

    @Test func soonestFirstThenName() {
        let apps = [
            AppFixture.make("x", name: "Zeta", next: nil),
            AppFixture.make("y", name: "Beta", next: "2027-01-05"),
            AppFixture.make("z", name: "Alpha", next: "2027-01-05"),
            AppFixture.make("w", name: "Gamma", next: "2026-12-01"),
        ]
        #expect(apps.sorted(by: ApplicationsOrdering.bySoonest).map(\.name) == ["Gamma", "Alpha", "Beta", "Zeta"])
    }

    @Test func stageCountsSkipZeros() {
        let counts = ApplicationsOrdering.stageCounts([AppFixture.make("1"), AppFixture.make("2"), AppFixture.make("3", status: .denied)])
        #expect(counts.map(\.stage) == [.waiting, .denied])
        #expect(counts.map(\.count) == [2, 1])
    }

    @Test func recordedOutcome() {
        #expect(AppFixture.make("a", status: .waitlisted).hasRecordedOutcome)
        #expect(AppFixture.make("a", status: .committed).hasRecordedOutcome)
        #expect(!AppFixture.make("a", status: .complete).hasRecordedOutcome)
    }
}

@Suite("Dates agenda")
struct ApplicationsAgendaTests {
    @Test func upcomingByMonth() {
        var waiting = AppFixture.make("w", name: "Waiting U", status: .submitted)
        waiting.decisionDate = KeyDate(date: "2027-03-20", kind: "Decision", estimated: true)
        let working = AppFixture.make("k", name: "Working U", status: .inProgress, deadline: "2027-01-01")
        let past = AppFixture.make("p", name: "Past U", status: .inProgress, deadline: "2026-01-01")
        var admitted = AppFixture.make("a", status: .admitted, deadline: "2027-01-01")
        admitted.decisionDate = KeyDate(date: "2027-03-01", kind: "Decision", estimated: false)
        let dates = [CriticalDate(date: "2027-01-15", label: "FAFSA", detail: ""), CriticalDate(date: "soon", label: "Bad", detail: "")]

        let months = ApplicationsAgenda.months(apps: [waiting, working, past, admitted], criticalDates: dates, today: "2026-11-23")
        #expect(months.map(\.id) == ["2027-01", "2027-03"])
        #expect(months[0].items.map(\.title) == ["Working U application due", "FAFSA"])
        #expect(months[0].items[1].detail == "Your date")
        #expect(months[1].items.first?.estimated == true)
        #expect(months[1].items.first?.applicationID == "w")
    }
}
