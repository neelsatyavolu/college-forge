import Foundation

/// GET /api/applications `data` (lib/tracker-service.ts `viewTracker`): every application the student tracks.
struct TrackerView: Codable, Hashable, Sendable {
    /// The workspace revision this snapshot came from; newer responses have a higher number.
    var revision: Int
    /// Automatic portal checks every 12 hours.
    var autocheck: Bool
    /// Email the student when a check finds something new.
    var emails: Bool
    /// Open (unresolved) flags.
    var flags: [TrackerFlag]
    var apps: [TrackedApplication]

    static let empty = TrackerView(revision: -1, autocheck: true, emails: true, flags: [], apps: [])

    func app(id: String) -> TrackedApplication? { apps.first { $0.id == id } }
}

extension TrackerView {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        revision = c.int(.revision)
        autocheck = c.bool(.autocheck, true)
        emails = c.bool(.emails, true)
        flags = c.array(.flags)
        apps = c.array(.apps)
    }
}

/// One application as the server presents it (`viewApp`): derived dates, decision state, never a password.
struct TrackedApplication: Codable, Hashable, Sendable, Identifiable {
    var id: String
    /// Catalog id, or nil for a school added by name.
    var collegeId: String?
    /// The shortlist slug this application belongs to.
    var slug: String?
    var name: String
    /// Site-relative logo path ("/logos/mit.png"); resolve with `AppConfig.resolve(_:)`.
    var logo: String?
    var portalName: String
    var portalUrl: String
    var status: AppStatus
    var statusLabel: String
    var stage: AppStage
    /// The student's round, or the portal's when the student set none.
    var round: ApplicationRound
    var roundFromPortal: Bool
    /// yyyy-mm-dd or "".
    var deadline: String
    var decisionDate: KeyDate?
    /// The next date worth knowing (deadline while working, then decision). Nil once a decision is posted.
    var nextDate: KeyDate?
    var decision: DecisionView
    var portal: PortalSnapshot?
    /// Required checklist items the portal shows as missing.
    var missing: [String]
    var submittedAt: String
    /// Open follow-ups, soonest first.
    var followUps: [FollowUp]
    var lastFailure: PortalFailure?
    var notes: String
    var decisionNote: String
    var login: PortalLogin?
    /// Milliseconds since 1970.
    var lastChecked: Double?
    var updatedAt: Double

    var lastCheckedDate: Date? { lastChecked.map(Date.init(milliseconds:)) }
}

extension TrackedApplication {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        collegeId = c.optionalString(.collegeId)
        slug = c.optionalString(.slug)
        name = c.string(.name)
        logo = c.optionalString(.logo)
        portalName = c.string(.portalName, "Applicant portal")
        portalUrl = c.string(.portalUrl)
        status = c.value(.status, .planning)
        statusLabel = c.string(.statusLabel, status.label)
        stage = c.value(.stage, status.stage)
        round = c.value(.round, .none)
        roundFromPortal = c.bool(.roundFromPortal)
        deadline = c.string(.deadline)
        decisionDate = c.optional(KeyDate.self, .decisionDate)
        nextDate = c.optional(KeyDate.self, .nextDate)
        decision = c.value(.decision, DecisionView())
        portal = c.optional(PortalSnapshot.self, .portal)
        missing = c.array(.missing)
        submittedAt = c.string(.submittedAt)
        followUps = c.array(.followUps)
        lastFailure = c.optional(PortalFailure.self, .lastFailure)
        notes = c.string(.notes)
        decisionNote = c.string(.decisionNote)
        login = c.optional(PortalLogin.self, .login)
        lastChecked = c.optionalDouble(.lastChecked)
        updatedAt = c.double(.updatedAt)
    }
}

/// A deadline or decision date. `estimated` means it comes from last cycle's timing.
struct KeyDate: Codable, Hashable, Sendable {
    /// yyyy-mm-dd.
    var date: String
    /// "Deadline" or "Decision".
    var kind: String
    var estimated: Bool
}

extension KeyDate {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = c.string(.date)
        kind = c.string(.kind)
        estimated = c.bool(.estimated)
    }
}

/// Whether a decision is posted and whether the student has opened it.
struct DecisionView: Codable, Hashable, Sendable {
    var state: DecisionState = .none
    /// The portal's words for the outcome, once revealed and only when it names one.
    var portalText = ""
}

extension DecisionView {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        state = c.value(.state, .none)
        portalText = c.string(.portalText)
    }
}

struct DecisionState: OpenEnum {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    /// Nothing yet.
    static let none = Self(rawValue: "none")
    /// The portal posted a decision the student hasn't opened. Reveal with `.reveal(id:)`.
    static let hidden = Self(rawValue: "hidden")
    static let revealed = Self(rawValue: "revealed")
    /// The student recorded an outcome status themselves.
    static let recorded = Self(rawValue: "recorded")
}

/// What the last portal check saw. Before a reveal, decision words are already stripped by the server.
struct PortalSnapshot: Codable, Hashable, Sendable {
    var checkedAt: Double
    var ok: Bool
    var error: String
    var statusText: String
    /// Words saying an update or decision was posted; "" if none.
    var update: String
    var checklist: [PortalItem]

    var checkedDate: Date { Date(milliseconds: checkedAt) }
}

extension PortalSnapshot {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        checkedAt = c.double(.checkedAt)
        ok = c.bool(.ok)
        error = c.string(.error)
        statusText = c.string(.statusText)
        update = c.string(.update)
        checklist = c.array(.checklist)
    }
}

struct PortalItem: Codable, Hashable, Sendable {
    var item: String
    var status: String
    var date: String
    var done: Bool
    var optional: Bool
}

extension PortalItem {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        item = c.string(.item)
        status = c.string(.status)
        date = c.string(.date)
        done = c.bool(.done)
        optional = c.bool(.optional)
    }
}

/// The latest check that failed after an earlier one worked.
struct PortalFailure: Codable, Hashable, Sendable {
    var at: Double
    var error: String
}

extension PortalFailure {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        at = c.double(.at)
        error = c.string(.error)
    }
}

/// Whether a portal login is saved. The password itself never leaves the server.
struct PortalLogin: Codable, Hashable, Sendable {
    var username: String
    var hasPassword: Bool
}

extension PortalLogin {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        username = c.string(.username)
        hasPassword = c.bool(.hasPassword)
    }
}

struct FollowUp: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var text: String
    /// yyyy-mm-dd or "".
    var due: String
    var done: Bool
    var createdAt: Double
}

extension FollowUp {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        text = c.string(.text)
        due = c.string(.due)
        done = c.bool(.done)
        createdAt = c.double(.createdAt)
    }
}

/// Something that needs attention across applications.
struct TrackerFlag: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var text: String
    /// Which applications it affects, in words.
    var scope: String
    var createdAt: Double
}

extension TrackerFlag {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        text = c.string(.text)
        scope = c.string(.scope)
        createdAt = c.double(.createdAt)
    }
}
