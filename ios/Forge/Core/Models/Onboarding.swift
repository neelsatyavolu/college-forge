import Foundation

struct OnboardingState: Codable, Hashable, Sendable {
    var completed = false
    var completedAt: Double?
    var storyNotes: StoryNotes?
    var listPrefs: ListPrefs?
}

extension OnboardingState {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        completed = c.bool(.completed)
        completedAt = c.optionalDouble(.completedAt)
        storyNotes = c.optional(StoryNotes.self, .storyNotes)
        listPrefs = c.optional(ListPrefs.self, .listPrefs)
    }
}

/// Free-form story the student wrote during onboarding, for the AI.
struct StoryNotes: Codable, Hashable, Sendable {
    var activities = ""
    var awards = ""
    var other = ""
}

extension StoryNotes {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        activities = c.string(.activities)
        awards = c.string(.awards)
        other = c.string(.other)
    }
}

/// How the preliminary college list should be built. Allowed values are enforced by the server:
/// ambition ambitious|balanced|conservative, size small|medium|large|any,
/// settings urban|suburban|rural|college-town, regions northeast|mid-atlantic|south|midwest|west|any,
/// appCount 8...15 or nil.
struct ListPrefs: Codable, Hashable, Sendable {
    var ambition = "balanced"
    var appCount: Int?
    var settings: [String] = []
    var size = "any"
    var regions: [String] = []
    var notes = ""

    private enum CodingKeys: String, CodingKey { case ambition, appCount, settings, size, regions, notes }
}

extension ListPrefs {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ambition = c.string(.ambition, "balanced")
        appCount = c.optionalInt(.appCount)
        settings = c.array(.settings)
        size = c.string(.size, "any")
        regions = c.array(.regions)
        notes = c.string(.notes)
    }

    /// Encodes `appCount: null` explicitly so the server clears it ("let Forge decide").
    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(ambition, forKey: .ambition)
        try c.encode(appCount, forKey: .appCount)
        try c.encode(settings, forKey: .settings)
        try c.encode(size, forKey: .size)
        try c.encode(regions, forKey: .regions)
        try c.encode(notes, forKey: .notes)
    }
}
