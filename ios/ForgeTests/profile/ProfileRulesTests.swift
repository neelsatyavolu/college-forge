import Foundation
import Testing
@testable import Forge

@Suite("Profile validation")
struct ProfileRulesTests {
    @Test func gpaRanges() {
        #expect(ProfileRules.weightedGPAError("") == nil)
        #expect(ProfileRules.weightedGPAError("4.25") == nil)
        #expect(ProfileRules.weightedGPAError("6") == nil)
        #expect(ProfileRules.weightedGPAError("6.1") != nil)
        #expect(ProfileRules.unweightedGPAError("3.9") == nil)
        #expect(ProfileRules.unweightedGPAError("4.2") != nil)
        #expect(ProfileRules.unweightedGPAError("-1") != nil)
        #expect(ProfileRules.unweightedGPAError("3.") != nil)
        #expect(ProfileRules.unweightedGPAError("1e0") != nil)
    }

    @Test func satMustBeWholeNumberInRange() {
        #expect(ProfileRules.satError("") == nil)
        #expect(ProfileRules.satError("1400") == nil)
        #expect(ProfileRules.satError("1400.5") != nil)
        #expect(ProfileRules.satError("399") != nil)
        #expect(ProfileRules.satError("1610") != nil)
    }

    @Test func gradYear() {
        #expect(ProfileRules.gradYearError("2027") == nil)
        #expect(ProfileRules.gradYearError("") == nil)
        #expect(ProfileRules.gradYearError("27") != nil)
        #expect(ProfileRules.gradYearError("2200") != nil)
    }

    @Test func activityRules() {
        var a = Activity(name: "Debate", type: "Speech")
        #expect(ProfileRules.activityError(a) == nil)
        a.desc = String(repeating: "x", count: 150)
        #expect(ProfileRules.activityError(a) == nil)
        a.desc = String(repeating: "x", count: 151)
        #expect(ProfileRules.activityError(a)?.contains("150") == true)
        a.desc = nil
        a.hpw = "169"
        #expect(ProfileRules.activityError(a) == "Hours per week must be between 0 and 168.")
        a.hpw = "10"
        a.wpy = "53"
        #expect(ProfileRules.activityError(a) == "Weeks per year must be between 0 and 52.")
        a.name = "  "
        #expect(ProfileRules.activityError(a) == "Give this activity a name.")
    }

    @Test func apScores() {
        #expect(ProfileRules.apScoreError(APScore(course: "Calculus AB", score: "5")) == nil)
        #expect(ProfileRules.apScoreError(APScore(course: "Calculus AB", score: "6")) != nil)
        #expect(ProfileRules.apScoreError(APScore(course: "", score: "4")) != nil)
    }

    @Test func descriptionCounter() {
        #expect(ProfileRules.descriptionRemaining("") == 150)
        #expect(ProfileRules.descriptionRemaining(String(repeating: "é", count: 160)) == -10)
    }

    @Test func linesAndRanking() {
        #expect(ProfileRules.lines(" AP Bio \n\n  Honors Chem\n") == ["AP Bio", "Honors Chem"])
        let ranked = ProfileRules.ranked([Activity(rank: 5, name: "B"), Activity(rank: 1, name: "A")])
        #expect(ranked.map(\.rank) == [1, 2])
        #expect(ranked.map(\.name) == ["B", "A"])
    }

    @Test func statsRoundTrip() {
        #expect(ProfileRules.editable("—") == "")
        #expect(ProfileRules.stored("  ") == "—")
        #expect(ProfileRules.stored(" 3.9 ") == "3.9")
    }

    @Test func identityDraftReadsWorkspaceAndValidates() {
        var ws = Workspace.empty
        ws.applicant.gpaWeighted = "4.3"
        ws.profile.testing.sat = "1500"
        var draft = ProfileIdentityDraft(workspace: ws)
        #expect(draft.gpaWeighted == "4.3")
        #expect(draft.gpaUnweighted == "")
        #expect(draft.sat == "1500")
        #expect(draft.error == nil)
        draft.gradYear = "20x7"
        #expect(draft.error != nil)
    }
}
