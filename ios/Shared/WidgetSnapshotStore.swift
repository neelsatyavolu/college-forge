import Foundation

/// Hands the snapshot from the app to the widget extension through a Keychain access group both share.
/// (A keychain group needs no App ID capability, so App Store signing stays as it was; an App Group would.)
/// The item uses the app's Keychain service, so `Keychain.clearAfterReinstall` wipes it with the rest.
enum WidgetSnapshotStore {
    static let account = "widget-snapshot"
    /// The kinds the widget extension registers; the app reloads them after writing.
    static let kinds = ["ForgeUpNext", "ForgeCountdown", "ForgeDecisions", "ForgeProgress", "ForgeDates"]

    /// "<team id>.co.xanom.forge.shared", from the ForgeSharedKeychainGroup Info.plist key.
    static var accessGroup: String? {
        Bundle.main.object(forInfoDictionaryKey: "ForgeSharedKeychainGroup") as? String
    }

    private static var keychain: Keychain { Keychain(accessGroup: accessGroup) }

    static func load() -> WidgetSnapshot? {
        guard let snapshot = keychain.value(WidgetSnapshot.self, for: account),
              snapshot.version == WidgetSnapshot.currentVersion else { return nil }
        return snapshot
    }

    @discardableResult
    static func save(_ snapshot: WidgetSnapshot) -> Bool {
        keychain.setValue(snapshot, for: account)
    }

    static func clear() {
        keychain.remove(account)
    }
}
