import Foundation

/// The setup wizard's steps. The web's AI-connect step is web-only and left out.
enum OnboardingStep: Int, CaseIterable, Identifiable {
    case welcome, identity, academics, story, prefs, documents, review
    var id: Int { rawValue }

    var title: String {
        switch self {
        case .welcome: "Welcome"
        case .identity: "About you"
        case .academics: "Academics"
        case .story: "Your story"
        case .prefs: "College list"
        case .documents: "Documents"
        case .review: "Review"
        }
    }
}

/// Everything the wizard collects, prefilled from the saved workspace (`initialDraft`, `initialStory`,
/// `initialPrefs` in Onboarding.jsx).
struct OnboardingAnswers: Equatable {
    var name = ""
    var gradYear = ""
    var cycle = ""
    var hs = ""
    var location = ""
    var intended = ""
    var gpaWeighted = ""
    var gpaUnweighted = ""
    var sat = ""
    var satNote = ""
    var testOptional = false
    var story = StoryNotes()
    var prefs = ListPrefs()

    init() {}

    init(workspace ws: Workspace) {
        let a = ws.applicant, p = ws.profile
        name = a.name
        gradYear = p.gradYear
        cycle = a.cycle
        hs = p.hs
        location = p.location
        intended = p.intended
        gpaWeighted = ProfileRules.editable(a.gpaWeighted)
        gpaUnweighted = ProfileRules.editable(a.gpaUnweighted)
        sat = a.sat.isPresentStat ? a.sat : ProfileRules.editable(p.testing.sat)
        satNote = a.satNote.isEmpty ? p.testing.satNote : a.satNote
        story = ws.onboarding.storyNotes ?? StoryNotes()
        var prefs = ws.onboarding.listPrefs ?? ListPrefs()
        if let n = prefs.appCount, n < 8 { prefs.appCount = nil }
        self.prefs = prefs
    }

    // MARK: Validation

    var identityError: String? {
        let ok = !name.profileTrimmed.isEmpty && !hs.profileTrimmed.isEmpty && !intended.profileTrimmed.isEmpty
            && !(gradYear.profileTrimmed.isEmpty && cycle.profileTrimmed.isEmpty)
        return ok ? nil : "Name, high school, intended major, and grad year are required."
    }

    var academicError: String? {
        if !gpaWeighted.isPresentStat && !gpaUnweighted.isPresentStat {
            return "Enter at least one GPA (weighted or unweighted)."
        }
        if gpaUnweighted.isPresentStat, !ProfileRules.isNumber(gpaUnweighted.profileTrimmed, in: 0...4) {
            return "Unweighted GPA must be a number from 0 to 4."
        }
        if gpaWeighted.isPresentStat, !ProfileRules.isNumber(gpaWeighted.profileTrimmed, in: 0...6) {
            return "Weighted GPA must be a number from 0 to 6."
        }
        if !testOptional { return ProfileRules.satError(sat) }
        return nil
    }

    func error(for step: OnboardingStep) -> String? {
        switch step {
        case .identity: identityError
        case .academics: academicError
        case .review: identityError ?? academicError
        default: nil
        }
    }

    // MARK: List preferences

    mutating func toggleSetting(_ id: String) {
        prefs.settings = Self.toggled(prefs.settings, id)
    }

    /// "Anywhere" clears the others; picking a region clears "Anywhere".
    mutating func toggleRegion(_ id: String) {
        if id == "any" { prefs.regions = ["any"]; return }
        prefs.regions = Self.toggled(prefs.regions.filter { $0 != "any" }, id)
    }

    private static func toggled(_ list: [String], _ id: String) -> [String] {
        list.contains(id) ? list.filter { $0 != id } : list + [id]
    }

    // MARK: Request

    /// The body of POST /api/workspace {action: "complete-onboarding"}, as the web sends it.
    var completionFields: [String: JSONValue] {
        let year = gradYear.profileTrimmed
        let sat = testOptional ? "—" : ProfileRules.stored(self.sat)
        let satNote = testOptional ? "Test optional" : self.satNote.profileTrimmed
        let cycleOut = cycle.profileTrimmed.isEmpty ? (year.isEmpty ? "" : "Fall \(year)") : cycle.profileTrimmed
        return [
            "applicant": .object([
                "name": .string(name.profileTrimmed),
                "cycle": .string(cycleOut),
                "year": .string(year.isEmpty ? "" : "Class of \(year)"),
                "gpaWeighted": .string(ProfileRules.stored(gpaWeighted)),
                "gpaUnweighted": .string(ProfileRules.stored(gpaUnweighted)),
                "sat": .string(sat),
                "satNote": .string(satNote),
            ]),
            "profile": .object([
                "intended": .string(intended.profileTrimmed),
                "hs": .string(hs.profileTrimmed),
                "gradYear": .string(year),
                "location": .string(location.profileTrimmed),
            ]),
            "testing": .object(["sat": .string(sat), "satNote": .string(satNote)]),
            "storyNotes": .object([
                "activities": .string(story.activities),
                "awards": .string(story.awards),
                "other": .string(story.other),
            ]),
            "listPrefs": .object([
                "ambition": .string(prefs.ambition),
                "appCount": prefs.appCount.map { .number(Double($0)) } ?? .null,
                "settings": .array(prefs.settings.map(JSONValue.string)),
                "size": .string(prefs.size),
                "regions": .array(prefs.regions.map(JSONValue.string)),
                "notes": .string(prefs.notes),
            ]),
        ]
    }

    /// Non-empty lines in a story box ("3 lines").
    static func lineCount(_ text: String) -> Int {
        ProfileRules.lines(text).count
    }
}

/// Choices for the list-preferences step, with the web's wording.
enum OnboardingOptions {
    struct Choice: Identifiable, Hashable {
        let id: String
        let title: String
        var blurb = ""
    }

    static let ambition = [
        Choice(id: "ambitious", title: "Ambitious", blurb: "A few major-fit dream reaches plus solid targets. Not a full Ivy lottery list."),
        Choice(id: "balanced", title: "Just right", blurb: "A realistic mix of reaches, targets, and safeties for your academics and interests."),
        Choice(id: "conservative", title: "Conservative", blurb: "Lean safer: more likely admits, fewer long-shot reaches."),
    ]
    static let settings = [Choice(id: "urban", title: "Urban"), Choice(id: "suburban", title: "Suburban"),
                           Choice(id: "rural", title: "Rural"), Choice(id: "college-town", title: "College town")]
    static let sizes = [Choice(id: "any", title: "Any size"), Choice(id: "small", title: "Small"),
                        Choice(id: "medium", title: "Medium"), Choice(id: "large", title: "Large")]
    static let regions = [Choice(id: "northeast", title: "Northeast"), Choice(id: "mid-atlantic", title: "Mid-Atlantic"),
                          Choice(id: "south", title: "South"), Choice(id: "midwest", title: "Midwest"),
                          Choice(id: "west", title: "West"), Choice(id: "any", title: "Anywhere")]
    static let appCounts = Array(8...15)

    static func title(_ id: String, in list: [Choice]) -> String {
        list.first { $0.id == id }?.title ?? id
    }
}
