import Foundation

/// Starter prompts and intro copy for an empty chat, picked from what the workspace is missing.
/// Mirrors `cfChatAdaptiveSuggestions` and `cfChatIntroCopy` in public/hub/AiChat.jsx.
enum MoreChatSuggestions {
    /// Up to `limit` prompts, most useful first.
    static func prompts(for ws: Workspace, limit: Int = 3) -> [String] {
        let facts = Facts(ws)
        var ranked: [String] = []
        func push(_ s: String) { if !ranked.contains(s) { ranked.append(s) } }

        // 1. Profile and uploads
        if facts.profileThin && ws.uploads.isEmpty {
            push("Here's my transcript and resume — build my profile.")
        } else if facts.profileThin {
            push("Read my uploads and fill GPA, coursework, testing, and activities.")
        } else if !facts.hasGPA {
            push("Set my GPA and high school from what I tell you.")
        } else if facts.activities == 0 {
            push("Help me structure my activities list for Common App (10 max).")
        } else if facts.honors == 0 {
            push("Add my awards and honors — I'll list them next.")
        } else if !facts.hasSAT && facts.aps == 0 {
            push("Add my SAT/ACT and AP scores to the Testing section.")
        } else if !facts.hasIdentity {
            push("Fill my profile basics: name, high school, intended major, location.")
        }

        // 2. College list
        let colleges = ws.colleges
        if colleges.isEmpty {
            push("Build me a balanced college list from my profile and preferences.")
            push("Add schools I'm interested in and tier them as reach / target / safety.")
        } else {
            if !facts.hasED {
                push(facts.topSchool.map { "What's my strongest Early Decision option — is \($0) realistic?" }
                     ?? "What's my strongest Early Decision option on this list?")
            }
            let reaches = colleges.filter { $0.tier == .reach }.count
            let targets = colleges.filter { $0.tier == .target }.count
            let safeties = colleges.filter { $0.tier == .safety }.count
            if reaches >= 5 && reaches > targets + safeties {
                push("My list is too reach-heavy — rebalance with real targets and safeties.")
            } else if targets == 0 || safeties == 0 {
                push("Find target and safety schools that fit my major and stats.")
            }
            if colleges.contains(where: { ($0.tier?.rawValue ?? "").isEmpty }) {
                push("Tier every school on my list as reach, target, or safety.")
            }
        }

        // 3. Essays
        let supplements = ws.essays.supplements.values.reduce(0) { $0 + $1.count }
        if !colleges.isEmpty && facts.drafts == 0 {
            push("Outline my Common App personal statement from my activities and story.")
        } else if !colleges.isEmpty && supplements == 0 {
            push(facts.topSchool != nil
                 ? "Pull supplement essay prompts for \(facts.schoolNames.prefix(2).joined(separator: " and "))."
                 : "Pull supplement essay prompts for schools on my list.")
        } else if facts.drafts > 0, let top = facts.topSchool {
            push("Critique my draft for \(top) and suggest stronger specifics.")
        }

        // 4. Logistics
        if !colleges.isEmpty {
            if ws.recommendations.isEmpty { push("Who should I ask for recommendations, and when should I ask?") }
            if facts.aidIdle { push("What should I know about FAFSA and CSS Profile for my schools?") }
            if ws.criticalDates.isEmpty { push("Populate critical dates and deadlines from my shortlist.") }
        }

        // Healthy-hub fallbacks
        push("Review my hub and tell me the three highest-leverage things to do next.")
        push("Compare my top two schools for major, fit, and admissions odds.")
        if let ed = ws.ed?.school, ed.isPresentStat {
            push("Help me strengthen my \(ed) Early Decision application.")
        }
        return Array(ranked.prefix(limit))
    }

    /// One short line above the prompts that matches how filled the hub is.
    static func intro(for ws: Workspace) -> String {
        let facts = Facts(ws)
        let count = ws.colleges.count
        if !facts.hasGPA && facts.activities == 0 && count == 0 {
            return "I build and maintain your hub. Upload a transcript, resume, or award list — or tell me your profile and target schools — and I'll fill in every page."
        }
        if count == 0 {
            return "Your profile is started. I can build a balanced college list, re-tier schools, or pull anything still missing into the hub."
        }
        if facts.drafts == 0 {
            return "You have \(count) school\(count == 1 ? "" : "s") on the list. I can rebalance tiers, pick an ED, draft essays, or fill any empty section."
        }
        return "Your hub is taking shape. Ask me to refine the list, strengthen essays, set deadlines, or update anything that looks off."
    }

    /// What the prompts are chosen from.
    private struct Facts {
        let hasGPA: Bool
        let hasSAT: Bool
        let hasIdentity: Bool
        let hasED: Bool
        let activities: Int
        let honors: Int
        let aps: Int
        let drafts: Int
        let aidIdle: Bool
        let schoolNames: [String]

        var profileThin: Bool { !hasGPA && activities == 0 && honors == 0 }
        var topSchool: String? { schoolNames.first }

        init(_ ws: Workspace) {
            let a = ws.applicant, p = ws.profile
            hasGPA = a.gpaUnweighted.isPresentStat || a.gpaWeighted.isPresentStat
            hasSAT = a.sat.isPresentStat || p.testing.sat.isPresentStat
            hasIdentity = a.name.isPresentStat || p.hs.isPresentStat || p.intended.isPresentStat || p.location.isPresentStat
            hasED = ws.ed?.school.isPresentStat ?? false
            activities = p.activities.count
            honors = p.honors.count
            aps = p.testing.aps.count
            drafts = ws.essayDrafts.values.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.count
            let fafsaIdle = ws.financialAid.fafsaStatus == .notStarted
            let cssIdle = [AidFormStatus.notStarted, .notApplicable].contains(ws.financialAid.cssStatus)
            aidIdle = fafsaIdle && cssIdle
            schoolNames = ws.colleges.prefix(3).map { $0.short.isEmpty ? $0.name : $0.short }.filter { !$0.isEmpty }
        }
    }
}
