import Foundation

/// Fixed messages, steps and small rules of the setup chat. Mirrors public/hub/OnboardingChat.jsx and ChatTiles.jsx.
enum SetupChat {
    static let kickoff = "Hi! I'm ready to set up Forge."
    static let researchDone = "Research is done. Recommend my early application plan."
    static let confirm = "Yes, that plan sounds right. Save my Early Decision and Early Action choices."
    static let showList = "Show me my draft college list."
    /// Messages Forge sends on the student's behalf: kept in the AI's history, not shown as theirs.
    static let hidden: Set<String> = [kickoff, researchDone, confirm, showList]
    static let historyLimit = 16

    static let sections: [(id: String, label: String)] = [
        ("basics", "Basics"), ("school", "Grades"), ("testing", "Testing"), ("activities", "Activities"),
        ("campus", "Campus"), ("money", "Money"), ("early", "Early plans"), ("deep", "Deeper"),
    ]

    static func sectionIndex(_ section: String) -> Int {
        sections.firstIndex { $0.id == section } ?? 0
    }

    /// The label beside the progress dots.
    static func stepLabel(phase: String, section: String) -> String {
        switch phase {
        case "interview": sections[sectionIndex(section)].label
        case "list": "Your list"
        case "research": "Research"
        case "strategy": "Early plan"
        case "plan": "Timeline"
        default: "Done"
        }
    }

    /// Drops a paragraph that repeats an earlier one in the same reply (dedupeParagraphs on the server).
    static func dedupe(_ text: String) -> String {
        func words(_ p: String) -> Set<String> {
            let cleaned = p.lowercased().map { $0.isLetter || $0.isNumber || $0.isWhitespace ? $0 : " " }
            return Set(String(cleaned).split(whereSeparator: \.isWhitespace).map(String.init).filter { $0.count > 2 })
        }
        var kept: [(text: String, words: Set<String>)] = []
        for part in text.split(separator: #/\n{2,}/#) {
            let para = String(part)
            let w = words(para)
            let repeats = w.count > 3 && kept.contains { k in
                Double(w.intersection(k.words).count) / Double(min(w.count, k.words.count)) >= 0.7
            }
            if !repeats, !para.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { kept.append((para, w)) }
        }
        return kept.map(\.text).joined(separator: "\n\n")
    }

    /// True when the message above a question already says the prompt, so it isn't shown twice.
    static func leadSays(_ lead: String, prompt: String) -> Bool {
        let norm = { (t: String) in
            String(t.lowercased().map { $0.isLetter || $0.isNumber ? $0 : " " })
                .split(separator: " ").joined(separator: " ")
        }
        let p = norm(prompt)
        return !p.isEmpty && norm(lead).contains(p)
    }

    static func isUC(_ name: String) -> Bool {
        name.range(of: #"\buniversity of california\b|^uc[ -]"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// Counts applications the way schools are applied to: every UC campus together is one.
    static func appCount(_ schools: [InterviewSchool]) -> Int {
        let nonUC = schools.filter { !isUC($0.name) }.count
        return nonUC + (schools.contains { isUC($0.name) } ? 1 : 0)
    }

    static let tierOrder = ["reach", "target", "likely"]

    static func tierLabel(_ tier: String) -> String {
        switch tier {
        case "reach": "Reach"
        case "likely": "Likely"
        default: "Target"
        }
    }

    /// "3 reach · 4 target · 2 likely"
    static func mix(_ schools: [InterviewSchool]) -> String {
        tierOrder.map { t in "\(schools.filter { $0.tier == t }.count) \(tierLabel(t).lowercased())" }.joined(separator: " · ")
    }

    static func sortedByTier(_ schools: [InterviewSchool]) -> [InterviewSchool] {
        schools.enumerated().sorted { a, b in
            let ta = tierOrder.firstIndex(of: a.element.tier) ?? 1, tb = tierOrder.firstIndex(of: b.element.tier) ?? 1
            return ta == tb ? a.offset < b.offset : ta < tb
        }.map(\.element)
    }

    /// The message sent when the student asks for changes to the list.
    static func reviseMessage(_ note: String, dropped: [String]) -> String {
        dropped.isEmpty ? note : "\(note) (I'd drop: \(dropped.joined(separator: ", ")))"
    }

    static func stageLabel(_ stage: String) -> String {
        switch stage {
        case "queued": "Waiting"
        case "searching": "Searching"
        case "reading": "Reading sources"
        case "saved": "Saving facts"
        case "done": "Verified"
        case "needs_review": "Needs a second look"
        default: stage
        }
    }
}
