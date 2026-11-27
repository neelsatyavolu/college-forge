import Foundation

/// A tracked application's chance estimate, as public/hub/Shortlist.jsx `oddsForApp` finds it.
extension CollegesOdds {
    /// The server's own key for the app first (`oddsKey`), then "app:<id>", then the shortlist school it belongs
    /// to: by slug or catalog id, by name or short name, or by a name that starts the other.
    static func forApp(_ app: TrackedApplication, in workspace: Workspace) -> AdmissionOdds? {
        let odds = workspace.admissionOdds
        if let key = app.oddsKey, let hit = odds[key] { return hit }
        if let hit = odds["app:\(app.id)"] { return hit }
        let name = schoolKey(app.name)
        let colleges = workspace.colleges.filter { !$0.slug.isEmpty && odds[$0.slug] != nil }
        let listed = colleges.first { $0.slug == app.slug || $0.slug == app.collegeId }
            ?? colleges.first { schoolKey($0.name) == name || schoolKey($0.short) == name }
            ?? colleges.first { c in
                let k = schoolKey(c.name)
                return !k.isEmpty && !name.isEmpty && (k.hasPrefix(name + " ") || name.hasPrefix(k + " "))
            }
        return listed.flatMap { odds[$0.slug] }
    }

    /// A school name for matching: "University of Michigan--Ann Arbor" and "The University of Michigan" line up.
    static func schoolKey(_ name: String) -> String {
        name.lowercased()
            .replacing(/\bthe\b/, with: " ")
            .replacing(/[–—\-,.'’()&]/, with: " ")
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }

    /// "18% chance", for rows.
    static func chanceText(_ odds: AdmissionOdds) -> String {
        "\(odds.percent)% chance"
    }
}
