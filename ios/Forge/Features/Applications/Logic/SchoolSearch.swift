import Foundation

/// Matching for "Add a school". Mirrors AddSchool in public/hub/AddSchool.jsx.
enum SchoolSearch {
    struct Results: Equatable {
        var shortlist: [College] = []
        var catalog: [CatalogSchool] = []
        /// Offer "Add <query>" for a school not in the list.
        var offersCustom = false
        var isEmpty: Bool { shortlist.isEmpty && catalog.isEmpty && !offersCustom }
    }

    /// Lowercased, "&" as "and", punctuation dropped, single spaces.
    static func normalize(_ s: String) -> String {
        let lowered = s.lowercased().replacingOccurrences(of: "&", with: "and")
        let mapped = lowered.unicodeScalars.map { scalar -> Character in
            let c = Character(scalar)
            return (("a"..."z").contains(c) || ("0"..."9").contains(c)) ? c : " "
        }
        return String(mapped).split(separator: " ").joined(separator: " ")
    }

    static func results(query: String, tracked: [TrackedApplication], shortlist: [College], catalog: [CatalogSchool]) -> Results {
        let q = normalize(query)
        let trackedIDs = Set(tracked.compactMap(\.collegeId))
        let trackedNames = Set(tracked.map { normalize($0.name) })
        let trackedSlugs = Set(tracked.compactMap(\.slug))

        let fromShortlist = shortlist
            .filter { !trackedSlugs.contains($0.slug) && !trackedNames.contains(normalize($0.name)) }
            .filter { q.isEmpty || normalize($0.name).contains(q) }
            .prefix(q.isEmpty ? 6 : 4)

        let fromCatalog: [CatalogSchool] = q.count < 2 ? [] : catalog
            .filter { !trackedIDs.contains($0.id) && (normalize($0.name).contains(q) || $0.id == q) }
            .sorted { a, b in
                let pa = normalize(a.name).hasPrefix(q), pb = normalize(b.name).hasPrefix(q)
                if pa != pb { return pa }
                return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
            }
            .prefix(8)
            .map { $0 }

        let exact = fromCatalog.contains { normalize($0.name) == q } || fromShortlist.contains { normalize($0.name) == q }
        return Results(shortlist: Array(fromShortlist), catalog: fromCatalog, offersCustom: !q.isEmpty && !exact)
    }
}
