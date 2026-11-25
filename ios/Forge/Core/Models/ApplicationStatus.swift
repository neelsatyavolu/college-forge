import Foundation

/// Application status ids from lib/tracker.ts `STATUSES`. Unknown values are kept and shown by raw name.
struct AppStatus: OpenEnum, Identifiable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    var id: String { rawValue }

    static let planning = Self(rawValue: "planning")
    static let inProgress = Self(rawValue: "in_progress")
    static let finalChecks = Self(rawValue: "final_checks")
    static let submitted = Self(rawValue: "submitted")
    static let submittedNpy = Self(rawValue: "submitted_npy")
    static let complete = Self(rawValue: "complete")
    static let deferred = Self(rawValue: "deferred")
    static let waitlisted = Self(rawValue: "waitlisted")
    static let admitted = Self(rawValue: "admitted")
    static let committed = Self(rawValue: "committed")
    static let denied = Self(rawValue: "denied")
    static let withdrawn = Self(rawValue: "withdrawn")

    /// Every status in the order the web picker lists them.
    static let all: [Self] = [
        .planning, .inProgress, .finalChecks, .submitted, .submittedNpy, .complete, .deferred,
        .waitlisted, .admitted, .committed, .denied, .withdrawn,
    ]

    var label: String {
        switch self {
        case .planning: "Not started"
        case .inProgress: "Writing"
        case .finalChecks: "Final checks"
        case .submitted: "Submitted"
        case .submittedNpy: "Submitted - NPY"
        case .complete: "Under review"
        case .deferred: "Deferred"
        case .waitlisted: "Waitlisted"
        case .admitted: "Admitted"
        case .committed: "Committed"
        case .denied: "Denied"
        case .withdrawn: "Withdrawn"
        default: rawValue.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    var stage: AppStage {
        switch self {
        case .planning, .inProgress, .finalChecks: .working
        case .submitted, .submittedNpy, .complete, .deferred, .waitlisted: .waiting
        case .admitted, .committed: .admitted
        case .denied: .denied
        case .withdrawn: .closed
        default: .working
        }
    }

    /// The student recorded an outcome (or a deferral/waitlist).
    var isOutcome: Bool {
        [.admitted, .committed, .denied, .deferred, .waitlisted].contains(self)
    }
}

/// Status groups used for sections on the Applications screen.
struct AppStage: OpenEnum, Identifiable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    var id: String { rawValue }

    static let working = Self(rawValue: "working")
    static let waiting = Self(rawValue: "waiting")
    static let admitted = Self(rawValue: "admitted")
    static let denied = Self(rawValue: "denied")
    static let closed = Self(rawValue: "closed")

    static let all: [Self] = [.working, .waiting, .admitted, .denied, .closed]

    var label: String {
        switch self {
        case .working: "Working on"
        case .waiting: "Waiting to hear"
        case .admitted: "Admitted"
        case .denied: "Not admitted"
        case .closed: "Withdrawn"
        default: rawValue.capitalized
        }
    }
}

/// Application round. `.none` (empty string) means "not set".
struct ApplicationRound: OpenEnum, Identifiable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    var id: String { rawValue }

    static let none = Self(rawValue: "")
    static let ed = Self(rawValue: "ED")
    static let ed2 = Self(rawValue: "ED2")
    static let ea = Self(rawValue: "EA")
    static let rea = Self(rawValue: "REA")
    static let rd = Self(rawValue: "RD")
    static let rolling = Self(rawValue: "Rolling")

    static let all: [Self] = [.none, .ed, .ed2, .ea, .rea, .rd, .rolling]

    var label: String {
        switch self {
        case .none: "Not set"
        case .ed: "Early Decision"
        case .ed2: "Early Decision II"
        case .ea: "Early Action"
        case .rea: "Restrictive Early Action"
        case .rd: "Regular Decision"
        case .rolling: "Rolling"
        default: rawValue
        }
    }

    /// The short form shown in rows ("ED", "RD"); empty when unset.
    var short: String { rawValue }
}
