import Foundation

/// The "About you" and academics fields, as typed. Stats are blank here and "—" on the server.
struct ProfileIdentityDraft: Equatable {
    var name = ""
    var cycle = ""
    var yearLabel = ""
    var gpaWeighted = ""
    var gpaUnweighted = ""
    var sat = ""
    var satNote = ""
    var intended = ""
    var hs = ""
    var gradYear = ""
    var location = ""
    var counselor = ""
    var residency = ""

    init() {}

    init(workspace ws: Workspace) {
        let a = ws.applicant, p = ws.profile
        name = a.name
        cycle = a.cycle
        yearLabel = a.year
        gpaWeighted = ProfileRules.editable(a.gpaWeighted)
        gpaUnweighted = ProfileRules.editable(a.gpaUnweighted)
        sat = ProfileRules.editable(p.testing.sat.isPresentStat ? p.testing.sat : a.sat)
        satNote = p.testing.satNote.isEmpty ? a.satNote : p.testing.satNote
        intended = p.intended
        hs = p.hs
        gradYear = p.gradYear
        location = p.location
        counselor = p.counselor
        residency = p.residency
    }

    /// The first problem with the academic numbers, in the web's wording.
    var error: String? {
        ProfileRules.unweightedGPAError(gpaUnweighted)
            ?? ProfileRules.weightedGPAError(gpaWeighted)
            ?? ProfileRules.satError(sat)
            ?? ProfileRules.gradYearError(gradYear)
    }
}

/// Profile writes. Each mirrors a part of the web's "Save profile" and updates the screen optimistically.
extension WorkspaceStore {
    func saveIdentity(_ d: ProfileIdentityDraft) async throws {
        if let error = d.error { throw APIError.server(status: 400, message: error) }
        let sat = ProfileRules.stored(d.sat)
        let applicant = WorkspacePatch.ApplicantPatch(
            name: d.name.profileTrimmed, cycle: d.cycle.profileTrimmed, year: d.yearLabel.profileTrimmed,
            gpaWeighted: ProfileRules.stored(d.gpaWeighted), gpaUnweighted: ProfileRules.stored(d.gpaUnweighted),
            sat: sat, satNote: d.satNote.profileTrimmed
        )
        var testing = workspace.profile.testing
        testing.sat = sat
        testing.satNote = d.satNote.profileTrimmed
        let profile = WorkspacePatch.ProfilePatch(
            intended: d.intended.profileTrimmed, hs: d.hs.profileTrimmed, gradYear: d.gradYear.profileTrimmed,
            location: d.location.profileTrimmed, counselor: d.counselor.profileTrimmed, residency: d.residency.profileTrimmed,
            testing: testing
        )
        try await patch(.with { $0.applicant = applicant; $0.profile = profile }) { ws in
            ws.applicant.name = applicant.name ?? ""
            ws.applicant.cycle = applicant.cycle ?? ""
            ws.applicant.year = applicant.year ?? ""
            ws.applicant.gpaWeighted = applicant.gpaWeighted ?? "—"
            ws.applicant.gpaUnweighted = applicant.gpaUnweighted ?? "—"
            ws.applicant.sat = sat
            ws.applicant.satNote = testing.satNote
            ws.profile.intended = profile.intended ?? ""
            ws.profile.hs = profile.hs ?? ""
            ws.profile.gradYear = profile.gradYear ?? ""
            ws.profile.location = profile.location ?? ""
            ws.profile.counselor = profile.counselor ?? ""
            ws.profile.residency = profile.residency ?? ""
            ws.profile.testing = testing
        }
    }

    /// Saves activities in this order (rank 1 first). Caps and checks like the web.
    func saveActivities(_ activities: [Activity]) async throws {
        guard activities.count <= ProfileRules.maxActivities else {
            throw APIError.server(status: 400, message: "Keep up to \(ProfileRules.maxActivities) activities.")
        }
        for (i, a) in activities.enumerated() {
            if let error = ProfileRules.activityError(a) {
                throw APIError.server(status: 400, message: "Activity \(i + 1): \(error)")
            }
        }
        let ranked = ProfileRules.ranked(activities)
        try await patch(.with { $0.profile = .init(activities: ranked) }) { $0.profile.activities = ranked }
    }

    func saveHonors(_ honors: [Honor]) async throws {
        guard honors.count <= ProfileRules.maxHonors else {
            throw APIError.server(status: 400, message: "Keep up to \(ProfileRules.maxHonors) honors.")
        }
        if let error = honors.lazy.compactMap(ProfileRules.honorError).first {
            throw APIError.server(status: 400, message: error)
        }
        try await patch(.with { $0.profile = .init(honors: honors) }) { ws in
            ws.profile.honors = honors
            ws.applicant.awards = honors.count
        }
    }

    func saveAPScores(_ scores: [APScore]) async throws {
        if let error = scores.lazy.compactMap(ProfileRules.apScoreError).first {
            throw APIError.server(status: 400, message: error)
        }
        var testing = workspace.profile.testing
        testing.aps = scores.map { APScore(course: $0.course.profileTrimmed, score: $0.score.profileTrimmed) }
        try await patch(.with { $0.profile = .init(testing: testing) }) { $0.profile.testing = testing }
    }

    func saveCoursework(_ coursework: Coursework) async throws {
        let clean = Coursework(
            honors: coursework.honors.map(\.profileTrimmed).filter { !$0.isEmpty },
            aps: coursework.aps.map(\.profileTrimmed).filter { !$0.isEmpty },
            senior: coursework.senior.map(\.profileTrimmed).filter { !$0.isEmpty }
        )
        try await patch(.with { $0.profile = .init(coursework: clean) }) { $0.profile.coursework = clean }
    }

    /// Adds a tracker flag ("Flag something that needs attention").
    func addFlag(_ text: String) async throws {
        let trimmed = text.profileTrimmed
        guard !trimmed.isEmpty else { return }
        try await perform(.flagAdd(text: String(trimmed.prefix(500))))
    }
}
