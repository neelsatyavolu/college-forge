import Foundation

/// The custom keys Forge puts next to `aps` in a push: `{"type":"portal_update","appId":"<tracked app id>"}`.
struct PushPayload: Equatable, Sendable {
    var type: String
    /// The tracked application the push is about, when there is one.
    var applicationID: String?

    static let portalUpdate = "portal_update"

    init(type: String, applicationID: String? = nil) {
        self.type = type
        self.applicationID = applicationID
    }

    /// Reads the payload from a notification's `userInfo`. Nil when it isn't a Forge push.
    init?(userInfo: [AnyHashable: Any]) {
        guard let type = userInfo["type"] as? String, !type.isEmpty else { return nil }
        self.type = type
        let id = (userInfo["appId"] as? String)?.trimmingCharacters(in: .whitespaces)
        applicationID = id?.isEmpty == false ? id : nil
    }

    var isPortalUpdate: Bool { type == Self.portalUpdate }
}

extension Data {
    /// APNs device tokens are sent to the server as lowercase hex.
    var hexString: String { map { String(format: "%02x", $0) }.joined() }
}
