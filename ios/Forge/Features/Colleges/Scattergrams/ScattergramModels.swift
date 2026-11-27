import Foundation

// GET /api/workspace/scattergrams (lib/scattergrams.ts `ScattergramDoc`): the student's Maia Learning
// scattergrams, imported on the website with a bookmark in Maia. Each point is a past applicant from the
// student's high school, so this stays in memory on the screen that shows it: never cached, logged or exported.

/// A past applicant's outcome. The server collapses Maia's text to these five values.
enum ScatterOutcome: String, CaseIterable, Hashable, Sendable {
    case accepted = "Accepted", denied = "Denied", waitlisted = "Waitlisted", deferred = "Deferred", other = "Other"

    init(label: String) {
        let text = label.trimmingCharacters(in: .whitespaces).lowercased()
        self = Self.allCases.first { $0.rawValue.lowercased() == text } ?? .other
    }
}

/// A whole test score, or nil for a value no score could be (so a bad number can't overflow `Int`).
private func scoreValue(_ value: Double) -> Int? {
    value.isFinite && abs(value) < 100_000 ? Int(value.rounded()) : nil
}

/// One past applicant. Either number may be missing; only points with both are plotted.
struct ScatterPoint: Decodable, Hashable, Sendable {
    var sat: Int?
    var gpa: Double?
    var result: ScatterOutcome
    var round: String?

    private enum CodingKeys: String, CodingKey { case sat, gpa, result, round }

    init(sat: Int?, gpa: Double?, result: ScatterOutcome, round: String? = nil) {
        self.sat = sat
        self.gpa = gpa
        self.result = result
        self.round = round
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sat = c.optionalDouble(.sat).flatMap(scoreValue)
        gpa = c.optionalDouble(.gpa).flatMap { $0.isFinite ? $0 : nil }
        result = ScatterOutcome(label: c.string(.result))
        round = c.optionalString(.round).flatMap { $0.isEmpty ? nil : $0 }
    }
}

/// Maia's average GPA and SAT for a school, or the student's own marker.
struct ScatterStats: Decodable, Hashable, Sendable {
    var gpa: Double?
    var sat: Int?

    private enum CodingKeys: String, CodingKey { case gpa, sat }

    init(gpa: Double? = nil, sat: Int? = nil) {
        self.gpa = gpa
        self.sat = sat
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        gpa = c.optionalDouble(.gpa).flatMap { $0.isFinite ? $0 : nil }
        sat = c.optionalDouble(.sat).flatMap(scoreValue)
    }
}

/// One school's imported scattergram.
struct CollegeScattergram: Decodable, Hashable, Identifiable, Sendable {
    var slug: String
    var name: String
    /// U.S. News rank at import time, when the school is in the top 250.
    var rank: Int?
    var n: Int
    var counts: [String: Int]
    var averages: ScatterStats
    var points: [ScatterPoint]

    var id: String { slug }

    private enum CodingKeys: String, CodingKey { case slug, name, rank, n, counts, averages, points }

    init(slug: String, name: String, rank: Int? = nil, counts: [String: Int] = [:], averages: ScatterStats = ScatterStats(), points: [ScatterPoint]) {
        self.slug = slug
        self.name = name
        self.rank = rank
        self.n = points.count
        self.counts = counts
        self.averages = averages
        self.points = points
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slug = c.string(.slug)
        name = c.string(.name, slug)
        rank = c.optionalInt(.rank)
        points = c.array(.points)
        n = c.optionalInt(.n) ?? points.count
        counts = c.dictionary(.counts)
        averages = c.value(.averages, ScatterStats())
    }

    var accepted: Int { counts[ScatterOutcome.accepted.rawValue] ?? 0 }
}

/// The whole imported file. `importedAt` is milliseconds since 1970.
struct ScattergramDoc: Decodable, Hashable, Sendable {
    var importedAt: Date?
    /// How many graduating classes Maia covered, e.g. "3".
    var classOfYears: String?
    var student: ScatterStats?
    var colleges: [String: CollegeScattergram]

    private enum CodingKeys: String, CodingKey { case importedAt, classOfYears, student, colleges }

    init(importedAt: Date? = nil, classOfYears: String? = nil, student: ScatterStats? = nil, colleges: [String: CollegeScattergram]) {
        self.importedAt = importedAt
        self.classOfYears = classOfYears
        self.student = student
        self.colleges = colleges
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        importedAt = c.optionalDouble(.importedAt).flatMap { $0.isFinite ? $0 : nil }.map { Date(timeIntervalSince1970: $0 / 1000) }
        classOfYears = c.optionalString(.classOfYears).flatMap { $0.isEmpty ? nil : $0 }
        student = c.optional(ScatterStats.self, .student)
        // Keyed by slug; a record missing its own slug takes the key.
        colleges = Dictionary(uniqueKeysWithValues: c.dictionary(.colleges, of: CollegeScattergram.self).map { key, college in
            var copy = college
            if copy.slug.isEmpty { copy.slug = key }
            if copy.name.isEmpty { copy.name = key }
            return (key, copy)
        })
    }
}

/// `{success, data}` where data is the doc or null when nothing was imported.
struct ScattergramsResponse: Decodable, Sendable {
    var data: ScattergramDoc?

    private enum CodingKeys: String, CodingKey { case data }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        data = c.optional(ScattergramDoc.self, .data)
    }
}
