import Foundation
import Testing
@testable import Forge

struct CollegesStaleOddsTests {
    @Test func fingerprintsMatchWebIncludingFallbacksAndUnicode() throws {
        var applicant = Applicant()
        var profile = Profile()
        #expect(try CollegesOdds.profileFingerprint(applicant: applicant, profile: profile, act: "") == "11026dd1")

        applicant.gpaUnweighted = "3.8"
        applicant.gpaWeighted = " 4.2 "
        applicant.sat = "—"
        applicant.satNote = " "
        profile.testing.sat = "1430"
        profile.testing.satNote = #"Use "SAT""#
        profile.intended = " ART/🎨 "
        profile.residency = "ca"
        let initial = try CollegesOdds.profileFingerprint(applicant: applicant, profile: profile, act: "31")
        #expect(initial == "11db29b5")
        #expect(try CollegesOdds.profileFingerprint(applicant: applicant, profile: profile, act: "32") != initial)

        applicant.sat = "1430"
        applicant.satNote = profile.testing.satNote
        applicant.name = "Sample Student"
        profile.testing.sat = "1400"
        profile.testing.satNote = ""
        #expect(try CollegesOdds.profileFingerprint(applicant: applicant, profile: profile, act: "31") == initial)
    }

    @Test func countsAllSavedEstimatesIncludingTrackedAndLegacy() throws {
        let json: JSONValue = [
            "admissionOdds": [
                "app:sample": ["profileFingerprint": "old"],
                "current": ["profileFingerprint": "11026dd1"],
                "legacy": [:],
                "empty": ["profileFingerprint": ""]
            ]
        ]
        let metadata = try json.decode(CollegesShortlistMetadata.self)
        #expect(metadata.staleKeys == ["app:sample"])
        #expect(metadata.staleNotice == "1 of 4 estimates were made before your profile changed. Re-estimate to use your current scores.")
    }

    @Test func allStaleAndNoStaleNotices() throws {
        let changed: JSONValue = [
            "profile": ["testing": ["act": "32"]],
            "admissionOdds": ["sample": ["profileFingerprint": "11026dd1"]]
        ]
        let metadata = try changed.decode(CollegesShortlistMetadata.self)
        #expect(metadata.staleKeys == ["sample"])
        #expect(metadata.staleNotice == "Estimated before your profile changed. Re-estimate to use your current scores.")

        let current: JSONValue = ["admissionOdds": ["sample": ["profileFingerprint": "11026dd1"]]]
        #expect(try current.decode(CollegesShortlistMetadata.self).staleNotice == nil)
        #expect(try JSONValue.object([:]).decode(CollegesShortlistMetadata.self).staleNotice == nil)
    }
}
