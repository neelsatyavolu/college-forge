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

    /// Starts tracking an application for a shortlist school (it then shows on the Applications tab).
    func shortlistTrack(_ college: College) async throws {
        try await perform(.add(name: college.name, slug: college.slug))
    }

    func shortlistTrackedApplication(for college: College) -> TrackedApplication? {
        CollegesShortlist.trackedApplication(for: college, in: applications)
    }
}
