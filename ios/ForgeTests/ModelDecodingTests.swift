import Foundation
import Testing
@testable import Forge

@Suite("Model decoding")
struct ModelDecodingTests {
    @Test func workspaceDecodesRealShape() throws {
        let ws = try Fixture.decode(Workspace.self, "workspace")
        #expect(ws.revision == 42)
        #expect(ws.applicant.name == "Sam Rivera")
        #expect(ws.applicant.awards == 3)
        #expect(ws.profile.gradYear == "2027")
        #expect(ws.profile.testing.aps.map(\.score) == ["5", "4"])
        #expect(ws.ed?.daysLeft == "9")
        #expect(ws.criticalDates.first?.source == "student")
        #expect(ws.essays.supplements["rice"]?.first?.limit == 150)
        #expect(ws.essays.supplements["uc"] == [])
        #expect(ws.essays.all.map(\.id) == ["ca-1", "rice-why"])
        #expect(ws.financialAid.cssStatus == .notApplicable)
        #expect(ws.advisorNotes.first?.createdDate == Date(timeIntervalSince1970: 1_790_000_000))
        #expect(ws.shares.first?.isActive == true)
        #expect(ws.onboarding.completed)
        #expect(ws.onboarding.listPrefs?.appCount == nil)
        #expect(ws.admissionOdds["rice"]?.factors.first?.effect == "up")
        #expect(ws.schoolStats["a1"]?["admitRate"]?.doubleValue == 0.08)
        #expect(!ws.needsOnboarding)
    }

    @Test func lenientFieldsDoNotDropData() throws {
        let ws = try Fixture.decode(Workspace.self, "workspace")
        // The non-object activity is skipped; "2" as a rank still decodes.
        #expect(ws.profile.activities.map(\.rank) == [1, 2])
        #expect(ws.profile.activities[0].hpw == "10")
        #expect(ws.profile.activities[0].college == true)
        #expect(ws.colleges.count == 2)
        #expect(ws.colleges[1].rank == 4)
        #expect(ws.colleges[1].short == "Pomona College")
        #expect(ws.colleges[0].photo == nil)
        #expect(ws.colleges[0].scorecardId == 227757)
        // Unknown enum values survive with their raw value.
        #expect(ws.colleges[1].tier?.rawValue == "dream-school")
        #expect(ws.recommendations[1].type.rawValue == "coach")
        #expect(ws.recommendations[1].status.rawValue == "pondering")
        // A draft with the wrong type is skipped, not fatal.
        #expect(ws.essayDrafts == ["ca-1": "When I was nine..."])
    }

    @Test func emptyObjectDecodesToDefaults() throws {
        let ws = try JSONDecoder().decode(Workspace.self, from: .json("{}"))
        #expect(ws.applicant.gpaWeighted == "—")
        #expect(ws.colleges.isEmpty)
        #expect(ws.needsOnboarding)
        #expect(ws.financialAid.fafsaStatus == .notStarted)
    }

    @Test func trackerDecodesAndToleratesUnknowns() throws {
        let tracker = try Fixture.decode(DataEnvelope<TrackerView>.self, "applications").data
        #expect(tracker.revision == 42)
        #expect(tracker.emails == false)
        #expect(tracker.flags.count == 1)
        #expect(tracker.apps.count == 3)

        let rice = try #require(tracker.app(id: "app-1"))
        #expect(rice.status == .submitted)
        #expect(rice.stage == .waiting)
        #expect(rice.round == .ed)
        #expect(rice.decisionDate?.estimated == true)
        #expect(rice.portal?.checklist.first?.done == false)
        #expect(rice.missing == ["Counselor Recommendation"])
        #expect(rice.followUps.first?.due == "2027-02-01")
        #expect(rice.login?.hasPassword == true)
        #expect(rice.lastCheckedDate != nil)

        let odd = try #require(tracker.app(id: "app-2"))
        #expect(odd.status.rawValue == "teleported")
        #expect(odd.status.label == "Teleported")
        #expect(odd.stage.rawValue == "somewhere")
        #expect(odd.round.rawValue == "EA2")
        #expect(odd.decision.state == .hidden)
        #expect(odd.decisionDate == nil)
        #expect(odd.portal == nil)
        #expect(odd.statusLabel == "Teleported")

        let numericID = try #require(tracker.app(id: "3"))
        #expect(numericID.status == .planning)
        #expect(numericID.portalName == "Applicant portal")
    }

    @Test func statusMetadataMatchesServer() {
        #expect(AppStatus.complete.label == "Under review")
        #expect(AppStatus.committed.stage == .admitted)
        #expect(AppStatus.withdrawn.stage == .closed)
        #expect(AppStatus.all.count == 12)
        #expect(ApplicationRound.none.label == "Not set")
    }

    @Test func openEnumRoundTrips() throws {
        let data = try JSONEncoder().encode([AppStatus.finalChecks, AppStatus(rawValue: "new_thing")])
        #expect(String(decoding: data, as: UTF8.self) == #"["final_checks","new_thing"]"#)
        #expect(try JSONDecoder().decode([AppStatus].self, from: data) == [.finalChecks, AppStatus(rawValue: "new_thing")])
    }

    @Test func workspaceRoundTripsThroughEncoding() throws {
        let ws = try Fixture.decode(Workspace.self, "workspace")
        let again = try JSONDecoder().decode(Workspace.self, from: JSONEncoder().encode(ws))
        #expect(again == ws)
    }

    @Test func essayLengthCountsUnits() {
        let words = Essay(id: "a", label: "", prompt: "", limit: 650, unit: "words")
        let chars = Essay(id: "b", label: "", prompt: "", limit: 250, unit: "characters")
        #expect(words.length(of: "One two  three\nfour") == 4)
        #expect(chars.length(of: "abc de") == 6)
    }
}
