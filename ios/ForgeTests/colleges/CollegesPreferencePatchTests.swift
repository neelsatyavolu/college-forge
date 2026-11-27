import Foundation
import Testing
@testable import Forge

@Suite("Recommendation preference patches")
struct CollegesPreferencePatchTests {
    @Test func savedAnswersUseServerTypesAndOnlyEditableFieldsArePatched() throws {
        let json = """
        {"profile":{"intended":"  Biology "},"onboarding":{"listPrefs":{"ambition":"ambitious",
        "appCount":12,"regions":["west"],"settings":["urban"],"notes":"Near public transit",
        "budget":"15-30","ed":"maybe","needAid":true,"size":"large","citizenship":"domestic",
        "suppCount":6,"noSuppCount":6,"countsRecommended":true}}}
        """
        var draft = try JSONDecoder().decode(CollegesPreferenceDraft.self, from: Data(json.utf8))
        #expect(draft.needAid && draft.budget == "15-30" && draft.ed == "maybe")
        draft.needAid = false
        let encoded = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(draft.patch))
        let expected: JSONValue = [
            "profile": ["intended": "Biology"],
            "listPrefs": ["ambition": "ambitious", "appCount": 12, "regions": ["west"],
                          "settings": ["urban"], "notes": "Near public transit", "budget": "15-30",
                          "ed": "maybe", "needAid": false]
        ]
        #expect(encoded == expected)
    }

    @Test func noTargetClearsTheCountAndUntouchedOptionalAnswersStayAbsent() throws {
        var draft = try JSONDecoder().decode(CollegesPreferenceDraft.self, from: Data(#"{"profile":{},"onboarding":{}}"#.utf8))
        let prefs = try #require(draft.patch["listPrefs"])
        #expect(prefs["appCount"] == .null)
        #expect(prefs["needAid"] == nil)
        #expect(prefs["budget"] == nil)
        #expect(prefs["ed"] == nil)
        draft.needAid = true
        #expect(draft.patch["listPrefs"]?["needAid"] == .bool(true))
    }

    @Test func leavesExistingOnboardingTotalsOutsidePickerRangeAlone() {
        var draft = CollegesPreferenceDraft()
        draft.appCount = 18
        #expect(draft.patch["listPrefs"]?["appCount"] == nil)
        draft.appCount = 8
        #expect(draft.patch["listPrefs"]?["appCount"] == .number(8))
        draft.appCount = nil
        #expect(draft.patch["listPrefs"]?["appCount"] == .null)
    }

    @Test func notesRespectTheWebsUTF16LengthLimit() {
        var draft = CollegesPreferenceDraft()
        let prefix = String(repeating: "x", count: 3999)
        draft.notes = prefix + "🌱"
        #expect(draft.patch["listPrefs"]?["notes"] == .string(prefix))
    }
}
