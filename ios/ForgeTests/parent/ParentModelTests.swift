import Foundation
import Testing
@testable import Forge

/// Synthetic replies shaped like /api/me, /api/parent/:id and /api/parents.
@Suite("Parent dashboard models")
struct ParentModelTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    @Test func meCarriesParentState() throws {
        let me = try decode(MeResponse.self, #"{"signedIn":true,"user":{"email":"p@forge.invalid","name":"Pat"},"parent":{"students":2,"home":true}}"#)
        #expect(me.parent.students == 2)
        #expect(me.parent.home)
        let old = try decode(MeResponse.self, #"{"signedIn":true,"user":null}"#)
        #expect(old.parent.students == 0, "an older server without the field means no parent links")
    }

    @Test func basicLevelLeavesOutSections() throws {
        let json = #"""
        {"level":"basic","levelLabel":"Basic","levelSummary":"applications","student":{"name":"Sam Student","cycle":"Fall 2027"},
         "progress":{"flags":[],"apps":[{"id":"a1","name":"Test U","status":"submitted","round":"EA","deadline":"2026-11-01","submittedAt":"2026-10-30","decision":{"state":"none"},"followUps":[],"missing":[]}]},
         "criticalDates":[{"date":"2026-12-01","label":"FAFSA opens","detail":""}]}
        """#
        let d = try decode(ParentDashboardData.self, json)
        #expect(d.firstName == "Sam")
        #expect(d.progress.apps.first?.status == .submitted)
        #expect(d.colleges == nil && d.profile == nil && d.essays == nil && d.financialAid == nil)
        #expect(d.deadlines.map(\.title) == ["FAFSA opens"], "a submitted app's deadline is past, an unsubmitted one shows")
    }

    @Test func fullLevelHasProfileAndEssays() throws {
        let json = #"""
        {"level":"full","levelLabel":"Full","levelSummary":"everything","student":{"name":"Sam","cycle":""},
         "progress":{"flags":[],"apps":[]},"criticalDates":[],
         "colleges":[{"slug":"test-u","name":"Test U","tier":"target"}],"recommendations":[],"scholarships":[],
         "financialAid":{"fafsaStatus":"submitted","cssStatus":"n_a"},
         "applicant":{"gpaWeighted":"4.2","gpaUnweighted":"3.9","sat":"1500"},
         "profile":{"intended":"CS","activities":[{"rank":1,"name":"Robotics","type":"Club"}]},
         "essays":{"commonApp":[{"id":"ca-1","label":"Personal statement","prompt":"Tell us","limit":650,"unit":"words"}],"supplements":{}},
         "essayDrafts":{"ca-1":"one two three"}}
        """#
        let d = try decode(ParentDashboardData.self, json)
        #expect(d.colleges?.first?.tier == .target)
        #expect(d.applicant?.gpaUnweighted == "3.9")
        #expect(d.profile?.activities.first?.name == "Robotics")
        #expect(d.essays?.all.first.map { $0.length(of: d.essayDrafts["ca-1"] ?? "") } == 3)
    }

    @Test func parentLinksDecode() throws {
        let reply = try decode(ParentsReply.self, #"{"success":true,"url":"https://forge.invalid/parent/accept?t=x","emailed":false,"data":[{"id":"l1","email":"p@forge.invalid","level":"standard","status":"active","invitedAt":1,"acceptedAt":2,"parentName":"Pat"},{"id":"l2","email":"q@forge.invalid","level":"basic","status":"invited","invitedAt":1,"expired":true}]}"#)
        #expect(reply.data.count == 2)
        #expect(reply.data[0].displayName == "Pat")
        #expect(reply.data[1].expired)
        #expect(!reply.emailed)
    }
}
