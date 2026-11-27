import Foundation

struct EssayDeadline: Hashable, Sendable {
    let date: String
    let round: String
    let school: String

    var shortDate: String { ForgeDates.day(date)?.formatted(.dateTime.month(.abbreviated).day()) ?? date }

    static func next(for colleges: [College], today: String) -> Self? {
        var best: Self?
        for college in colleges {
            for deadline in UpcomingDeadlines.planDeadlines(for: college) {
                guard deadline.date >= today,
                      best.map({ deadline.date < $0.date }) ?? true,
                      let day = ForgeDates.day(deadline.date), ForgeDates.iso(day) == deadline.date,
                      UpcomingDeadlines.kind(of: deadline.plan) == "round" else { continue }
                best = Self(date: deadline.date, round: roundLabel(deadline.plan),
                            school: college.short.isEmpty ? college.name : college.short)
            }
        }
        return best
    }

    private static func roundLabel(_ plan: String) -> String {
        let tokens = UpcomingDeadlines.roundTokens(plan)
        let name = plan.lowercased()
        if name.contains("early decision") || tokens.contains(where: { $0.hasPrefix("ED") }) { return "ED" }
        if name.contains("restrictive") || tokens.contains("REA") || tokens.contains("SCEA") { return "REA" }
        if name.contains("early action") || tokens.contains(where: { $0.hasPrefix("EA") }) { return "EA" }
        if name.contains("rolling") { return "Rolling" }
        if name.contains("priority") { return "Priority" }
        return "RD"
    }
}

/// Supplemental fields from the essay definition that the Core model doesn't carry.
struct EssayPromptRule: Decodable, Sendable {
    let id: String
    var required: Bool?
    var chooseGroup: String?
    var choose: Int?
}

struct EssayWritingProgress {
    var required = 0
    var drafted = 0
    var final = 0
    var wordsWritten = 0
    var wordsRequired = 0
    var unfinishedGroups: Set<String> = []
    var next: EssayDeadline?

    init(groups: [EssayGroup], drafts: [String: String], status: [String: String], rules: [String: EssayPromptRule]) {
        var earliest: EssayDeadline?
        for group in groups where group.kind != .orphan {
            var sets: [String: (choose: Int, essays: [Essay])] = [:]
            var requiredEssays: [Essay] = []
            for essay in group.essays {
                let rule = rules[essay.id]
                if let (key, picks) = Self.choice(for: essay, rule: rule) {
                    sets[key, default: (picks, [])].essays.append(essay)
                } else if rule?.required != false,
                          essay.label.range(of: #"\(optional\)|only if this applies"#, options: [.regularExpression, .caseInsensitive]) == nil,
                          essay.prompt.range(of: #"^optional\b"#, options: [.regularExpression, .caseInsensitive]) == nil {
                    requiredEssays.append(essay)
                }
            }
            func count(_ essay: Essay) -> Int { EssayMetrics.count(drafts[essay.id] ?? essay.starter ?? "", for: essay) }
            for set in sets.values {
                let ranked = set.essays.sorted { lhs, rhs in
                    let leftFinal = status[lhs.id] == "final"
                    let rightFinal = status[rhs.id] == "final"
                    if leftFinal != rightFinal { return leftFinal }
                    let left = count(lhs), right = count(rhs)
                    return left == right ? lhs.limit > rhs.limit : left > right
                }
                requiredEssays.append(contentsOf: ranked.prefix(set.choose))
            }
            for essay in requiredEssays {
                let length = count(essay)
                required += 1
                if status[essay.id] == "final" { final += 1 } else { unfinishedGroups.insert(group.key) }
                if status[essay.id] == "final" || length > 0 { drafted += 1 }
                if !essay.unit.localizedCaseInsensitiveContains("character") {
                    wordsRequired += essay.limit
                    wordsWritten += min(length, essay.limit)
                }
            }
            if let due = group.due {
                if earliest.map({ due.date < $0.date }) ?? true { earliest = due }
                if unfinishedGroups.contains(group.key), next.map({ due.date < $0.date }) ?? true { next = due }
            }
        }
        next = next ?? earliest
    }

    private static func choice(for essay: Essay, rule: EssayPromptRule?) -> (String, Int)? {
        if let group = rule?.chooseGroup, !group.isEmpty, let n = rule?.choose, n > 0 { return (group, n) }
        if essay.id.hasPrefix("ca-ps-") { return ("common", 1) }
        if essay.id.hasPrefix("uc-piq-") { return ("uc", 4) }
        return nil
    }
}
