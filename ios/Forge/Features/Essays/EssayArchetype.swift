import Foundation

struct EssayTypeSection: Identifiable {
    let id: EssayArchetype
    let items: [EssayItem]
    var label: String { id.rawValue }
}

struct EssayCopySource: Identifiable {
    let id: String
    let label: String
    let text: String
}

/// Cases are in the display order of public/hub/essay-archetypes.js.
enum EssayArchetype: String, CaseIterable, Sendable {
    case personal = "Personal statement"
    case additional = "Additional information"
    case whyMajor = "Why this major"
    case whySchool = "Why this school"
    case short = "Short takes"
    case community = "Community and identity"
    case challenge = "Challenge or disagreement"
    case activity = "Activity"
    case curiosity = "Intellectual curiosity"
    case other = "Other prompts"

    private func matches(_ text: String) -> Bool {
        let pattern: String
        switch self {
        case .additional:
            pattern = #"additional info|anything else|special circumstances|change in your grades|context (that )?we should|not (otherwise )?reflected|would like (us|the (admissions )?committee) to know|covid"#
        case .whyMajor:
            pattern = #"why this major|intended (major|program)|(selected|chosen|first[- ]choice|intended) (major|academic program|program of study|area of study)|chosen this major|program of study|why .{0,30}\bstudy\b|educational plans|areas? of study|academic (interest|areas?)|(academic|career|professional) goals|(interest|interested) in (your |the )?[\w-]*\s?(choice )?major|what draws you to the subject|interest in (studying|the major)"#
        case .whySchool:
            pattern = #"^why\b|why this college|why (are you applying|did you choose|do you want|you want)|good (match|fit)|best fit|attract(s)? you|appeal(s)? to you|interested in attending|motivated you to apply|reasons for (choosing|wishing to enroll)|during your college search|thrive (in|at)|how did you (first )?learn about"#
        case .community:
            pattern = #"divers|communit|identity|background|culture|belong|difference"#
        case .challenge:
            pattern = #"challeng|obstacle|setback|failure|disagree|viewpoint|conflict|difficult|harder than you expected|changing beliefs|changed your mind"#
        case .activity:
            pattern = #"activit|extracurricular|work experience|employment|commitment outside|leadership|service|job you hold|responsibilit"#
        case .curiosity:
            pattern = #"intellectual|curio|\bideas?\b|track of time|question|problem|excite|learn more|\btexts?\b"#
        case .personal, .short, .other:
            return false
        }
        return text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func classify(_ essay: Essay) -> EssayArchetype {
        if EssayMetrics.isPersonalStatement(essay) { return .personal }
        let text = essay.label + "\n" + essay.prompt
        if additional.matches(text) { return .additional }
        if whyMajor.matches(text) { return .whyMajor }
        if whySchool.matches(essay.label) || whySchool.matches(essay.prompt) { return .whySchool }

        let characterLimit = essay.unit.localizedCaseInsensitiveContains("character")
        if essay.limit > 0 && essay.limit <= (characterLimit ? 350 : 50) { return .short }

        let topics: [Self] = [.community, .challenge, .activity, .curiosity]
        return topics.first { $0.matches(essay.label) } ?? topics.first { $0.matches(text) } ?? .other
    }

    static func sections(for items: [EssayItem]) -> [EssayTypeSection] {
        let grouped = Dictionary(grouping: items) { classify($0.essay) }
        func wordEquivalentLimit(_ essay: Essay) -> Double {
            Double(essay.limit) / (essay.unit.localizedCaseInsensitiveContains("character") ? 6 : 1)
        }
        return allCases.compactMap { kind in
            guard let matching = grouped[kind] else { return nil }
            let sorted = matching.sorted { wordEquivalentLimit($0.essay) > wordEquivalentLimit($1.essay) }
            return EssayTypeSection(id: kind, items: sorted)
        }
    }

    static func copySources(for essay: Essay, items: [EssayItem], drafts: [String: String]) -> [EssayCopySource] {
        let kind = classify(essay)
        var same: [EssayCopySource] = []
        var other: [EssayCopySource] = []
        for item in items where item.id != essay.id {
            let text = drafts[item.id] ?? item.essay.starter ?? ""
            guard text.contains(where: { !$0.isWhitespace }) else { continue }
            let count = EssayMetrics.count(text, for: item.essay)
            let label = "\(item.badge) · \(item.essay.label) (\(count) \(item.essay.unit))"
            let source = EssayCopySource(id: item.id, label: label, text: text)
            if classify(item.essay) == kind {
                same.append(source)
            } else {
                other.append(source)
            }
        }
        return same + other
    }
}
