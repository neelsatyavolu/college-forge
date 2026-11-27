import Foundation

/// GET /api/me.
struct MeResponse: Codable, Hashable, Sendable {
    var signedIn: Bool
    var user: User?
    /// Parent accounts: how many students this account follows.
    var parent: Parent = Parent()

    struct User: Codable, Hashable, Sendable {
        var email: String
        var name: String
    }

    struct Parent: Codable, Hashable, Sendable {
        var students = 0
        /// The parent dashboard opens instead of the tabs: they follow someone and have no applications of their own.
        var home = false
        /// Some student invited this account as their counselor: the dashboard reads as a counselor's.
        var counselor = false
    }
}

extension MeResponse {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        signedIn = c.bool(.signedIn)
        user = c.optional(User.self, .user)
        parent = c.value(.parent, Parent())
    }
}

extension MeResponse.Parent {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        students = c.int(.students)
        home = c.bool(.home)
        counselor = c.bool(.counselor)
    }
}

extension MeResponse.User {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        email = c.string(.email)
        name = c.string(.name)
    }
}

/// One school from GET /api/applications/catalog (the "Add a school" picker).
struct CatalogSchool: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var name: String
    var state: String
    var monogram: String
    /// Brand colors as CSS hex strings, primary first.
    var colors: [String]
    var portalName: String
    var loginUrl: String
    var howToLogIn: String
    var logo: String?
}

extension CatalogSchool {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        name = c.string(.name)
        state = c.string(.state)
        monogram = c.string(.monogram)
        colors = c.array(.colors)
        portalName = c.string(.portalName)
        loginUrl = c.string(.loginUrl)
        howToLogIn = c.string(.howToLogIn)
        logo = c.optionalString(.logo)
    }
}

/// An assistant connected over OAuth (GET /api/connections). This app's own grant appears here too,
/// named "Forge for iPhone".
struct Connection: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var name: String
    var host: String
    /// Milliseconds since 1970.
    var createdAt: Double

    var createdDate: Date { Date(milliseconds: createdAt) }
}

extension Connection {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        name = c.string(.name)
        host = c.string(.host)
        createdAt = c.double(.createdAt)
    }
}

/// The forwarding inbox for portal emails (`inbox` in POST /api/applications {action:"inbox"}).
struct InboxStatus: Codable, Hashable, Sendable {
    /// The forwarding address, or nil when forwarding is off.
    var address: String?
    /// Whether a birthdate is saved for portals that ask for one.
    var birthdate: Bool
    /// New portals set up from a forwarded email get the master password.
    var useMasterForNew: Bool = false
    /// The last forwarded emails and what happened, newest first.
    var recent: [RecentArrival] = []
}

extension InboxStatus {
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        address = c.optionalString(.address)
        birthdate = c.bool(.birthdate)
        useMasterForNew = c.bool(.useMasterForNew)
        recent = c.array(.recent)
    }
}
