import Foundation

/// The editable copy of the recommendation preferences.
struct CollegesPreferenceDraft: Equatable {
    var intended = ""
    var ambition = "balanced"
    var regions: [String] = []
    var settings: [String] = []

    var appCount: Int?
    var budget = ""
    var ed = ""
    var needAid = false
    var hadAidAnswer = false
    var notes = ""

    static let budgets = [(id: "lt15", label: "Under $15,000 a year"), (id: "15-30", label: "$15,000–$30,000 a year"), (id: "30-50", label: "$30,000–$50,000 a year"), (id: "50plus", label: "$50,000 or more a year"), (id: "unsure", label: "Not sure yet")]
    static let edChoices = [(id: "yes", label: "I would apply ED"), (id: "maybe", label: "Maybe"), (id: "no", label: "No ED")]
    static let ambitions: [CollegesAmbition] = [.balanced, .ambitious, .conservative]
    static let regions = [(id: "northeast", label: "New England"), (id: "mid-atlantic", label: "Mid-Atlantic"), (id: "south", label: "South"), (id: "midwest", label: "Midwest"), (id: "west", label: "West")]
    static let settings = [(id: "urban", label: "City"), (id: "suburban", label: "Suburban"), (id: "college-town", label: "College town"), (id: "rural", label: "Rural")]

    init() {}

    /// Keeps app count, size and notes from the saved preferences.
    func listPrefs(merging saved: ListPrefs?) -> ListPrefs {
        var prefs = saved ?? ListPrefs()
        prefs.ambition = ambition
        prefs.regions = regions
        prefs.settings = settings
        return prefs
    }

    /// Adds or removes one value.
    static func toggled(_ list: [String], _ value: String, on: Bool) -> [String] {
        let rest = list.filter { $0 != value }
        return on ? rest + [value] : rest
    }
}

extension CollegesPreferenceDraft: Decodable {
    private enum WorkspaceKeys: CodingKey { case profile, onboarding }
    private enum ProfileKeys: CodingKey { case intended }
    private enum OnboardingKeys: CodingKey { case listPrefs }
    private enum ExtraKeys: CodingKey { case budget, ed, needAid }

    init(from decoder: any Decoder) throws {
        self.init()
        let root = try decoder.container(keyedBy: WorkspaceKeys.self)
        let profile = try root.nestedContainer(keyedBy: ProfileKeys.self, forKey: .profile)
        intended = profile.string(.intended)
        guard let onboarding = try? root.nestedContainer(keyedBy: OnboardingKeys.self, forKey: .onboarding),
              let saved = onboarding.optional(ListPrefs.self, .listPrefs) else { return }
        ambition = saved.ambition
        appCount = saved.appCount
        regions = saved.regions
        settings = saved.settings
        notes = saved.notes
        let extras = try onboarding.nestedContainer(keyedBy: ExtraKeys.self, forKey: .listPrefs)
        budget = extras.string(.budget)
        ed = extras.string(.ed)
        let aid = extras.optional(Bool.self, .needAid)
        hadAidAnswer = aid != nil
        needAid = aid ?? false
    }

    /// Matches the textarea's 4,000 UTF-16 code unit limit without cutting a character in two.
    static func limitedNotes(_ value: String) -> String {
        guard value.utf16.count > 4000 else { return value }
        var units = 0
        return String(value.prefix { character in
            units += character.utf16.count
            return units <= 4000
        })
    }

    /// The server merges listPrefs by key. Only send fields this sheet edits.
    var patch: JSONValue {
        let filters = listPrefs(merging: nil)
        var prefs: [String: JSONValue] = [
            "ambition": .string(filters.ambition),
            "regions": .array(filters.regions.map(JSONValue.string)),
            "settings": .array(filters.settings.map(JSONValue.string)),
            "notes": .string(Self.limitedNotes(notes))
        ]
        // Onboarding may have set a total outside 8...15 from its two workload counts.
        if let appCount {
            if (8...15).contains(appCount) { prefs["appCount"] = .number(Double(appCount)) }
        } else {
            prefs["appCount"] = .null
        }
        if Self.budgets.contains(where: { $0.id == budget }) { prefs["budget"] = .string(budget) }
        if Self.edChoices.contains(where: { $0.id == ed }) { prefs["ed"] = .string(ed) }
        if needAid || hadAidAnswer { prefs["needAid"] = .bool(needAid) }
        return [
            "profile": ["intended": .string(intended.trimmingCharacters(in: .whitespacesAndNewlines))],
            "listPrefs": .object(prefs)
        ]
    }
}

extension APIClient {
    func collegePreferenceDraft() async throws -> CollegesPreferenceDraft {
        try await get("/api/workspace")
    }

    func patchCollegeWorkspace(_ body: JSONValue) async throws -> Workspace {
        try await patch("/api/workspace", body: body, as: DataEnvelope<Workspace>.self).data
    }
}
