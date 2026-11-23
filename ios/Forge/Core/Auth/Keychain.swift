import Foundation
import Security

/// Minimal generic-password Keychain access. Items stay on this device and are readable after the first
/// unlock, so a push that wakes the app in the background can still refresh data.
struct Keychain: Sendable {
    let service: String

    init(service: String = "co.xanom.forge") {
        self.service = service
    }

    func data(for account: String) -> Data? {
        var query = baseQuery(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }

    @discardableResult
    func set(_ data: Data, for account: String) -> Bool {
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(baseQuery(account) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let add = baseQuery(account).merging(attributes) { $1 }
            return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
        }
        return status == errSecSuccess
    }

    func remove(_ account: String) {
        SecItemDelete(baseQuery(account) as CFDictionary)
    }

    func value<T: Decodable>(_ type: T.Type, for account: String) -> T? {
        data(for: account).flatMap { try? JSONDecoder().decode(T.self, from: $0) }
    }

    @discardableResult
    func setValue(_ value: some Encodable, for account: String) -> Bool {
        guard let data = try? JSONEncoder().encode(value) else { return false }
        return set(data, for: account)
    }

    /// Keychain items outlive deleting the app, which would sign a reinstall straight back in (with the old
    /// OAuth client and AI cookies). The first launch of an install starts clean. Returns whether it wiped.
    @discardableResult
    func clearAfterReinstall(defaults: UserDefaults = .standard) -> Bool {
        let key = "ForgeInstalled"
        guard !defaults.bool(forKey: key) else { return false }
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        SecItemDelete(query as CFDictionary)
        defaults.set(true, forKey: key)
        return true
    }

    private func baseQuery(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
