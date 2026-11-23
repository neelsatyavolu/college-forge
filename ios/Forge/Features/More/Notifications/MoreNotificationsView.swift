import SwiftUI
import UserNotifications

/// GET/PATCH /api/devices: whether Forge sends portal pushes to this account, and how many devices get them.
struct MoreDeviceSettings: Decodable, Equatable, Sendable {
    var pushEnabled: Bool
    var count: Int

    init(pushEnabled: Bool, count: Int) {
        self.pushEnabled = pushEnabled
        self.count = count
    }

    private enum CodingKeys: String, CodingKey { case pushEnabled, count }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pushEnabled = c.bool(.pushEnabled, true)
        count = c.int(.count)
    }
}

extension APIClient {
    func moreDeviceSettings() async throws -> MoreDeviceSettings {
        try await get("/api/devices", as: DataEnvelope<MoreDeviceSettings>.self).data
    }

    func moreSetPushEnabled(_ enabled: Bool) async throws -> MoreDeviceSettings {
        try await patch("/api/devices", body: ["pushEnabled": enabled], as: DataEnvelope<MoreDeviceSettings>.self).data
    }
}

/// Portal-update notifications: the iPhone's permission and the account's on/off switch.
struct MoreNotificationsView: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(PushManager.self) private var push
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var settings: MoreDeviceSettings?
    @State private var loadError: APIError?
    @State private var saving = false
    @State private var error: APIError?

    var body: some View {
        List {
            Section {
                permissionRow
            } header: {
                Text("This iPhone")
            } footer: {
                Text("Forge tells you when a portal check finds news: a decision posted, a status change or a missing document.")
            }
            if push.isAuthorized {
                accountSection
            }
            if let lastError = push.lastError {
                Section { ErrorBanner(message: lastError) }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
        }
        .navigationTitle("Notifications")
        .forgeScreenBackground()
        .refreshable { await load() }
        .task { await load() }
        .onChange(of: scenePhase) { _, phase in
            // Back from the Settings app: the permission may have changed.
            if phase == .active { Task { await push.refreshAuthorizationStatus() } }
        }
        .errorAlert($error)
    }

    @ViewBuilder
    private var permissionRow: some View {
        switch push.authorizationStatus {
        case .notDetermined:
            Button {
                Task {
                    if await push.requestAuthorization() { Haptics.success() }
                    await load()
                }
            } label: {
                Label("Turn on notifications", systemImage: "bell.badge")
            }
        case .denied:
            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                Label("Notifications are off for Forge", systemImage: "bell.slash")
                    .foregroundStyle(Theme.ink)
                Text("Turn them on in the Settings app.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
            }
        default:
            Label("Allowed on this iPhone", systemImage: "checkmark.circle.fill")
                .foregroundStyle(Theme.ink)
                .symbolRenderingMode(.hierarchical)
        }
    }

    @ViewBuilder
    private var accountSection: some View {
        Section {
            if let settings {
                Toggle(isOn: Binding(get: { settings.pushEnabled }, set: { setEnabled($0) })) {
                    Text("Portal updates")
                }
                .disabled(saving)
                if settings.count > 0 {
                    LabeledValueRow(label: "Devices", value: "\(settings.count)")
                }
            } else if let loadError {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text(loadError.message).font(.subheadline).foregroundStyle(Theme.muted)
                    Button("Try again") { Task { await load() } }
                }
            } else {
                HStack { ProgressView(); Text("Loading…").foregroundStyle(Theme.muted) }
            }
        } header: {
            Text("Your account")
        } footer: {
            Text("Turning this off stops pushes to every device signed in to your account.")
        }
    }

    private func load() async {
        await push.refreshAuthorizationStatus()
        guard push.isAuthorized else { return }
        do {
            settings = try await store.api.moreDeviceSettings()
            loadError = nil
        } catch {
            loadError = APIError.wrap(error)
        }
    }

    private func setEnabled(_ enabled: Bool) {
        guard let current = settings else { return }
        settings?.pushEnabled = enabled
        saving = true
        Haptics.selection()
        Task {
            do {
                settings = try await store.api.moreSetPushEnabled(enabled)
            } catch {
                settings = current
                self.error = APIError.wrap(error)
                Haptics.error()
            }
            saving = false
        }
    }
}

#Preview {
    NavigationStack { MoreNotificationsView() }.previewEnvironment()
}
