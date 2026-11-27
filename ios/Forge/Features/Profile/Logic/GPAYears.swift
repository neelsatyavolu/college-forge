import Foundation

/// Unweighted GPA by school year (`applicant.gpaByYear`), as in public/hub/Profile.jsx. The server sets
/// `gpaTrend` and `gpaRecent` from these years (lib/gpa-years.ts); the app only edits and shows them.
enum GPAYears {
    struct Year: Hashable, Sendable {
        let key: String
        let label: String
    }

    static let all: [Year] = [
        Year(key: "9", label: "9th grade"),
        Year(key: "10", label: "10th grade"),
        Year(key: "11", label: "11th grade"),
        Year(key: "12", label: "12th grade"),
    ]

    /// The web's message for a year that isn't a 0–4 number, or nil when it's fine or blank.
    static func error(_ raw: String, year: Year) -> String? {
        let v = raw.profileTrimmed
        return v.isEmpty || ProfileRules.isNumber(v, in: 0...4) ? nil : "\(year.label) GPA must be a number from 0 to 4, or left blank."
    }

    static func firstError(_ draft: [String: String]) -> String? {
        all.lazy.compactMap { error(draft[$0.key] ?? "", year: $0) }.first
    }

    /// Every year, with "—" for a blank one so the server clears it (years merge there).
    static func patch(_ draft: [String: String]) -> [String: String] {
        Dictionary(uniqueKeysWithValues: all.map { y in
            let v = (draft[y.key] ?? "").profileTrimmed
            return (y.key, v.isEmpty ? "—" : v)
        })
    }

    /// What the workspace holds after saving: only the years that have a value.
    static func stored(_ draft: [String: String]) -> [String: String] {
        patch(draft).filter { $0.value.isPresentStat }
    }

    /// "Unweighted by year: 9th 3.6 · 10th 3.8 · trending up · 10th–11th 3.85", or nil with no years on file.
    static func summary(_ a: Applicant) -> String? {
        let years = all.compactMap { y in
            a.gpaByYear[y.key].map { "\(y.label.replacingOccurrences(of: " grade", with: "")) \($0)" }
        }
        guard !years.isEmpty else { return nil }
        let trend = a.gpaTrend.flatMap { ["up": "trending up", "steady": "steady", "down": "trending down"][$0] }
        let recent = a.gpaRecent.flatMap { $0.isPresentStat ? "10th–11th \($0)" : nil }
        return "Unweighted by year: " + (years + [trend, recent].compactMap { $0 }).joined(separator: " · ")
    }
}
