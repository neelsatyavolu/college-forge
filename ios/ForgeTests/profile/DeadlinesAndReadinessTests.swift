import Foundation
import Testing
@testable import Forge

@Suite("Upcoming deadlines")
struct UpcomingDeadlinesTests {
    @Test func roundTokens() {
        #expect(UpcomingDeadlines.roundTokens("ED I") == ["ED"])
        #expect(UpcomingDeadlines.roundTokens("ed ii") == ["ED II"])
        #expect(UpcomingDeadlines.roundTokens("REA / SCEA") == ["REA", "SCEA"])
        #expect(UpcomingDeadlines.roundTokens("Regular Decision").isEmpty)
        #expect(UpcomingDeadlines.kind(of: "EA merit scholarship") == "scholarship")
        #expect(UpcomingDeadlines.kind(of: "CSS Profile") == "aid")
        #expect(UpcomingDeadlines.kind(of: "RD") == "round")
    }

    @Test func planDeadlinesFollowChosenRound() {
        var c = College(slug: "s", name: "Synthetic U")
        c.deadlines = [
            PlanDeadline(plan: "EA", date: "2026-11-01"),
            PlanDeadline(plan: "RD", date: "2027-01-05"),
            PlanDeadline(plan: "EA scholarship", date: "2026-11-15"),
            PlanDeadline(plan: "Financial aid", date: "2027-02-01"),
        ]
        #expect(UpcomingDeadlines.planDeadlines(for: c).count == 4)
        c.deadline = "EA · Nov 1"
        #expect(UpcomingDeadlines.planDeadlines(for: c).map(\.plan) == ["EA", "EA scholarship", "Financial aid"])
        c.deadline = "RD · Jan 5"
        #expect(UpcomingDeadlines.planDeadlines(for: c).map(\.plan) == ["RD", "Financial aid"])
    }

    @Test func buildMergesSourcesSortedAndFuture() {
        var ws = Workspace.empty
        ws.criticalDates = [CriticalDate(date: "2026-12-01", label: "FAFSA check", detail: ""),
                            CriticalDate(date: "2026-10-01", label: "Old", detail: "")]
        ws.scholarships = [Scholarship(id: "1", name: "Local award", deadline: "2026-11-30", status: .researching),
                           Scholarship(id: "2", name: "Won one", deadline: "2026-12-30", status: .won)]
        ws.recommendations = [Recommendation(id: "r", name: "Ms. Example", type: .teacher, status: .asked, deadline: "2026-12-10")]
        let tracker = TrackerView(revision: 1, autocheck: true, emails: true, flags: [], apps: [
            PreviewData.app(id: "a", name: "Synthetic College", status: .inProgress, round: .rd, deadline: "2027-01-01"),
            PreviewData.app(id: "b", name: "Done College", status: .submitted, round: .rd, deadline: "2027-01-02"),
        ])
        let items = UpcomingDeadlines.build(workspace: ws, tracker: tracker, today: "2026-11-23")
        #expect(items.map(\.title) == ["Local award", "FAFSA check", "Ms. Example", "Synthetic College"])
        #expect(items.last?.applicationID == "a")
    }

    @Test @MainActor func monthsGroup() {
        let items = [UpcomingDeadline(date: "2026-11-30", title: "A", kind: .keyDate),
                     UpcomingDeadline(date: "2026-11-30", title: "B", kind: .keyDate),
                     UpcomingDeadline(date: "2026-12-01", title: "C", kind: .keyDate)]
        #expect(DeadlinesView.months(items).map(\.items.count) == [2, 1])
    }
}

@Suite("Readiness")
struct ProfileReadinessTests {
    @Test func emptyWorkspaceHasNothingDone() {
        let r = ProfileReadiness(workspace: .empty)
        #expect(r.doneCount == 0)
        #expect(r.nextItem?.id == "basics")
    }

    @Test func filledWorkspace() {
        var ws = Workspace.empty
        ws.applicant.name = "Sam"
        ws.applicant.gpaUnweighted = "3.8"
        ws.profile.hs = "Synthetic High"
        ws.profile.intended = "Biology"
        ws.profile.gradYear = "2027"
        ws.profile.activities = [Activity(rank: 1, name: "Band", desc: String(repeating: "x", count: 151))]
        ws.profile.honors = [Honor(title: "Award")]
        ws.profile.coursework.aps = ["AP Bio"]
        ws.colleges = [College(slug: "x", name: "X")]
        let r = ProfileReadiness(workspace: ws)
        let done = Dictionary(uniqueKeysWithValues: r.items.map { ($0.id, $0.isDone) })
        #expect(done["basics"] == true)
        #expect(done["gpa"] == true)
        #expect(done["activities"] == false) // over the limit
        #expect(done["honors"] == true)
        #expect(done["essays"] == false)
        #expect(r.nextItem?.id == "activities")
    }
}
