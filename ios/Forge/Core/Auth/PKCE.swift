import CryptoKit
import Foundation

/// Proof Key for Code Exchange (RFC 7636), S256 only, which is all Forge accepts.
struct PKCE: Sendable, Equatable {
    let verifier: String
    let challenge: String
    static let method = "S256"

    init(verifier: String) {
        self.verifier = verifier
        self.challenge = Self.challenge(for: verifier)
    }

    /// A fresh 43-character verifier from 32 random bytes.
    static func generate() -> PKCE {
        PKCE(verifier: randomURLSafeString(bytes: 32))
    }

    static func challenge(for verifier: String) -> String {
        Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncoded()
    }

    static func randomURLSafeString(bytes count: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: count)
        let status = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        precondition(status == errSecSuccess, "No secure randomness available")
        return Data(bytes).base64URLEncoded()
    }
}

extension Data {
    /// Base64url without padding.
    func base64URLEncoded() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
