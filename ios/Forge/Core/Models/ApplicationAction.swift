import Foundation

/// Fields that `.add` and `.update` can set on an application. Nil fields are left alone.
/// Dates are yyyy-mm-dd or "" to clear; `portalUrl` must start with https:// or be "".
struct ApplicationEdit: Encodable, Hashable, Sendable {
    var status: AppStatus?
    var round: ApplicationRound?
    var deadline: String?
    var decisionDate: String?
    var notes: String?
    var decisionNote: String?
    var portalUrl: String?
    var name: String?
    var submittedAt: String?
    var testing: TestingEdit?
    /// The school's aid offer (whole dollars; the server sets `updatedAt`).
    var aidOffer: AidOffer?
}

/// One POST /api/applications action (app/api/applications/route.ts). The server replies with the whole
/// tracker in `data`, which `WorkspaceStore` applies for you.
enum ApplicationAction: Encodable, Hashable, Sendable {
    /// Add by catalog id or by name. `slug` links it to a shortlist school.
    case add(name: String? = nil, collegeId: String? = nil, slug: String? = nil, portalUrl: String? = nil, edit: ApplicationEdit = .init())
    case update(id: String, edit: ApplicationEdit)
    case remove(id: String)
    /// Open a posted decision (`decision.state == .hidden`).
    case reveal(id: String)
    /// Save a portal login (stored encrypted on the server).
    case login(id: String, username: String, password: String)
    case forgetLogin(id: String)
    case autocheck(on: Bool)
    case emails(on: Bool)
    /// `on == nil` reads the inbox status without changing it.
    case inbox(on: Bool? = nil, newAddress: Bool? = nil, birthdate: String? = nil, useMasterForNew: Bool? = nil)
    /// When automatic checks run: every 8, 12 or 24 hours from `startHour` (0-23) in `timeZone`.
    case schedule(everyHours: Int, startHour: Int, timeZone: String)
    /// Set or replace the master login; an empty username means the account email.
    case masterLogin(username: String, password: String)
    case forgetMaster
    /// Use (or stop using) the master login for one school.
    case useMaster(id: String, on: Bool)
    /// Use the master login for every catalog portal without a login.
    case applyMasterAll
    /// The PIN, link and password a forwarded set-up email left (`TrackedApplication.setupWaiting`).
    case setupDetails(id: String)
    /// Check portals now; nil checks every app with a saved login. Can take up to two minutes.
    case check(ids: [String]? = nil)
    case importCollegeApps(email: String, password: String)
    case followUpAdd(id: String, text: String, due: String? = nil)
    case followUpSet(id: String, followUpId: String, done: Bool? = nil, remove: Bool? = nil)
    case flagAdd(text: String, scope: String? = nil)
    case flagResolve(flagId: String)
    /// Log a visit, session, interview or contact. `edit.kind` and `edit.date` are required.
    case interestAdd(id: String, edit: InterestEdit)
    /// Change or (`edit.remove`) delete one logged entry.
    case interestSet(id: String, interestId: String, edit: InterestEdit)

    var name: String {
        switch self {
        case .add: "add"
        case .update: "update"
        case .remove: "remove"
        case .reveal: "reveal"
        case .login: "login"
        case .forgetLogin: "forget-login"
        case .autocheck: "autocheck"
        case .emails: "emails"
        case .inbox: "inbox"
        case .schedule: "schedule"
        case .masterLogin: "master-login"
        case .forgetMaster: "forget-master"
        case .useMaster: "use-master"
        case .applyMasterAll: "apply-master-all"
        case .setupDetails: "setup-details"
        case .check: "check"
        case .importCollegeApps: "import-collegeapps"
        case .followUpAdd: "followup-add"
        case .followUpSet: "followup-set"
        case .flagAdd: "flag-add"
        case .flagResolve: "flag-resolve"
        case .interestAdd: "interest-add"
        case .interestSet: "interest-set"
        }
    }

    private struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(_ s: String) { stringValue = s }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        try c.encode(name, forKey: Key("action"))
        func put<T: Encodable>(_ key: String, _ value: T?) throws {
            if let value { try c.encode(value, forKey: Key(key)) }
        }
        func putInterest(_ e: InterestEdit) throws {
            try put("kind", e.kind); try put("date", e.date); try put("time", e.time); try put("who", e.who)
            try put("notes", e.notes); try put("thankYouSent", e.thankYouSent); try put("done", e.done); try put("remove", e.remove)
        }
        switch self {
        case let .add(name, collegeId, slug, portalUrl, edit):
            try put("name", name); try put("collegeId", collegeId); try put("slug", slug); try put("portalUrl", portalUrl)
            try put("status", edit.status); try put("round", edit.round); try put("deadline", edit.deadline)
            try put("decisionDate", edit.decisionDate); try put("notes", edit.notes)
            try put("decisionNote", edit.decisionNote); try put("submittedAt", edit.submittedAt)
        case let .update(id, edit):
            try put("id", id); try put("edit", edit)
        case let .remove(id), let .reveal(id), let .forgetLogin(id):
            try put("id", id)
        case let .login(id, username, password):
            try put("id", id); try put("username", username); try put("password", password)
        case let .autocheck(on), let .emails(on):
            try put("on", on)
        case let .inbox(on, newAddress, birthdate, useMasterForNew):
            try put("on", on); try put("newAddress", newAddress); try put("birthdate", birthdate)
            try put("useMasterForNew", useMasterForNew)
        case let .schedule(everyHours, startHour, timeZone):
            try put("everyHours", everyHours); try put("startHour", startHour); try put("timeZone", timeZone)
        case let .masterLogin(username, password):
            try put("username", username); try put("password", password)
        case .forgetMaster, .applyMasterAll:
            break
        case let .useMaster(id, on):
            try put("id", id); try put("on", on)
        case let .setupDetails(id):
            try put("id", id)
        case let .check(ids):
            try put("ids", ids)
        case let .importCollegeApps(email, password):
            try put("email", email); try put("password", password)
        case let .followUpAdd(id, text, due):
            try put("id", id); try put("text", text); try put("due", due)
        case let .followUpSet(id, followUpId, done, remove):
            try put("id", id); try put("followUpId", followUpId); try put("done", done); try put("remove", remove)
        case let .flagAdd(text, scope):
            try put("text", text); try put("scope", scope)
        case let .flagResolve(flagId):
            try put("flagId", flagId)
        case let .interestAdd(id, edit):
            try put("id", id); try putInterest(edit)
        case let .interestSet(id, interestId, edit):
            try put("id", id); try put("interestId", interestId); try putInterest(edit)
        }
    }
}

/// Reply to POST /api/applications. `data` is the whole tracker after the action.
struct ApplicationsResponse: Decodable, Sendable {
    var data: TrackerView?
    /// The application that was added or changed.
    var app: TrackedApplication?
    /// Results of a `.check`.
    var checked: [TrackedApplication]?
    var inbox: InboxStatus?
    /// `.importCollegeApps` counts.
    var added: Int?
    var linked: Int?
    var total: Int?
    /// The master login's state (GET and the master actions).
    var master: MasterLoginStatus?
    /// `.applyMasterAll`: schools it was turned on for.
    var applied: Int?
    /// `.setupDetails` reply.
    var setup: SetupDetails?

    private enum CodingKeys: String, CodingKey { case data, app, checked, inbox, added, linked, total, master, applied, setup }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        data = c.optional(TrackerView.self, .data)
        app = c.optional(TrackedApplication.self, .app)
        checked = c.optional([Lossy<TrackedApplication>].self, .checked)?.compactMap(\.value)
        inbox = c.optional(InboxStatus.self, .inbox)
        added = c.optionalInt(.added)
        linked = c.optionalInt(.linked)
        total = c.optionalInt(.total)
        master = c.optional(MasterLoginStatus.self, .master)
        applied = c.optionalInt(.applied)
        setup = c.optional(SetupDetails.self, .setup)
    }
}
