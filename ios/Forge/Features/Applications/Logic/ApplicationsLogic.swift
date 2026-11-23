import Foundation

/// Why a school needs the student's eyes, beyond its date. Mirrors `attentionOf` in public/hub/ApplicationParts.jsx.
/// Declared in urgency order: an unopened decision first, then a failed check, then missing documents.
enum ApplicationAttention: Int, CaseIterable, Comparable, Sendable {
    case decision, check, missing

    static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }
}

extension TrackedApplication {
    var attention: [ApplicationAttention] {
        var out: [ApplicationAttention] = []
        if decision.state == .hidden { out.append(.decision) }
        // After a decision the portal checklist is leftovers (final transcript), not a to-do.
        guard stage == .working || stage == .waiting else { return out }
        if !missing.isEmpty { out.append(.missing) }
        if portal?.ok == false || lastFailure != nil { out.append(.check) }
        return out.sorted()
    }

    var needsAttention: Bool { !attention.isEmpty }

    /// Lower is more urgent; 3 when the school is quiet.
    var attentionRank: Int { attention.first?.rawValue ?? 3 }

    var hasSavedPassword: Bool { login?.hasPassword == true }

    /// The outcome is recorded (or the school deferred/waitlisted the student).
    var hasRecordedOutcome: Bool {
        stage == .admitted || stage == .denied || status == .deferred || status == .waitlisted
    }

    /// The decision date the student set themselves; estimated dates don't count.
    var ownDecisionDate: String {
        guard let decisionDate, !decisionDate.estimated else { return "" }
        return decisionDate.date
    }
}

struct ApplicationGroup: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let apps: [TrackedApplication]
    let isAttention: Bool
}

enum ApplicationsOrdering {
    /// Soonest next date first; schools without one last, then by name.
    static func bySoonest(_ a: TrackedApplication, _ b: TrackedApplication) -> Bool {
        let da = a.nextDate?.date ?? "9999", db = b.nextDate?.date ?? "9999"
        if da != db { return da < db }
        return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
    }

    static func byUrgency(_ a: TrackedApplication, _ b: TrackedApplication) -> Bool {
        if a.attentionRank != b.attentionRank { return a.attentionRank < b.attentionRank }
        return bySoonest(a, b)
    }

    /// "Needs attention" first, then one group per stage. Empty groups are dropped.
    static func byStatus(_ apps: [TrackedApplication]) -> [ApplicationGroup] {
        let attention = apps.filter(\.needsAttention).sorted(by: byUrgency)
        let quiet = apps.filter { !$0.needsAttention }
        var groups: [ApplicationGroup] = []
        if !attention.isEmpty {
            groups.append(ApplicationGroup(id: "attention", title: "Needs attention", apps: attention, isAttention: true))
        }
        let known = Set(AppStage.all)
        for stage in AppStage.all {
            let list = quiet.filter { $0.stage == stage }.sorted(by: bySoonest)
            if !list.isEmpty { groups.append(ApplicationGroup(id: stage.rawValue, title: stage.label, apps: list, isAttention: false)) }
        }
        let other = quiet.filter { !known.contains($0.stage) }.sorted(by: bySoonest)
        if !other.isEmpty { groups.append(ApplicationGroup(id: "other", title: "Other", apps: other, isAttention: false)) }
        return groups
    }

    /// Stage counts for the summary strip, in stage order, zero counts dropped.
    static func stageCounts(_ apps: [TrackedApplication]) -> [(stage: AppStage, count: Int)] {
        AppStage.all.compactMap { stage in
            let n = apps.filter { $0.stage == stage }.count
            return n > 0 ? (stage, n) : nil
        }
    }
}
