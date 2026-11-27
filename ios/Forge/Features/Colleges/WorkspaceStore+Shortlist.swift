import Foundation

/// Shortlist writes for the Colleges tab. Each is optimistic through `setColleges`/`updateCollege` and throws
/// `APIError` after rolling back.
extension WorkspaceStore {
    func shortlistContains(_ college: College) -> Bool {
        CollegesShortlist.contains(college, in: workspace.colleges)
    }

    /// The saved copy of a school, if it is on the shortlist.
    func shortlistCollege(matching college: College) -> College? {
        workspace.colleges.first { CollegesShortlist.same($0, college) }
    }

    func shortlistAdd(_ college: College) async throws {
        try await setColleges(CollegesShortlist.adding(college, to: workspace.colleges))
    }

    func shortlistRemove(slug: String) async throws {
        try await setColleges(CollegesShortlist.removing(slug: slug, from: workspace.colleges))
    }

    func shortlistSetTier(_ tier: CollegeTier, for college: College) async throws {
        var changed = college
        changed.tier = tier
        try await updateCollege(changed)
    }

    /// POST /api/workspace {action: "assess-tiers"}: gives every untiered school its data tier, or one from its
    /// chance estimate (lib/college-recommendations.ts assessUntiered). Tiers already set stay.
    func shortlistAssessTiers() async throws -> (assessed: [String], unknown: [String]) {
        let response = try await postAction("assess-tiers")
        guard response.data != nil else {
            throw APIError.server(status: 200, message: "Could not assess your schools. Please try again.")
        }
        return (response.assessed, response.unknown)
    }

    /// Starts tracking an application for a shortlist school (it then shows on the Applications tab).
    func shortlistTrack(_ college: College) async throws {
        try await perform(.add(name: college.name, slug: college.slug))
    }

    func shortlistTrackedApplication(for college: College) -> TrackedApplication? {
        CollegesShortlist.trackedApplication(for: college, in: applications)
    }
}
