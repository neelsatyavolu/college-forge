import Observation
import SwiftUI

/// The five tabs, in order.
enum AppTab: String, CaseIterable, Hashable, Sendable {
    case applications, essays, colleges, profile, more

    var title: String {
        switch self {
        case .applications: "Applications"
        case .essays: "Essays"
        case .colleges: "Colleges"
        case .profile: "Profile"
        case .more: "More"
        }
    }

    var systemImage: String {
        switch self {
        case .applications: "tray.full"
        case .essays: "doc.text"
        case .colleges: "building.columns"
        case .profile: "person.crop.circle"
        case .more: "ellipsis.circle"
        }
    }
}

/// Push this onto `Router.applicationsPath` to show one application. The Applications screen registers
/// `.navigationDestination(for: ApplicationRoute.self)`.
struct ApplicationRoute: Hashable, Sendable {
    let id: String
}

/// App-wide navigation state: the selected tab and one navigation path per tab.
/// Deep links (push taps, collegeforge:// URLs) come through here.
@MainActor
@Observable
final class Router {
    #if DEBUG
    /// Launch argument `-ForgeTab colleges` switches to that tab once data has loaded, like a tap would
    /// (simulator screenshots without UI automation).
    func applyLaunchTab() {
        if let tab = UserDefaults.standard.string(forKey: "ForgeTab").flatMap(AppTab.init(rawValue:)) { selectedTab = tab }
    }
    #endif

    var selectedTab: AppTab = .applications
    var applicationsPath = NavigationPath()
    var essaysPath = NavigationPath()
    var collegesPath = NavigationPath()
    var profilePath = NavigationPath()
    var morePath = NavigationPath()
    /// A prompt another tab wants the copilot to start with. The More tab opens its chat, puts the prompt
    /// in the composer and clears this.
    var pendingChatPrompt: String?

    /// Shows one application on the Applications tab, replacing whatever was pushed there.
    func openApplication(id: String) {
        selectedTab = .applications
        var path = NavigationPath()
        path.append(ApplicationRoute(id: id))
        applicationsPath = path
    }

    /// Switches to the copilot on the More tab with `prompt` ready to send.
    func openChat(prompt: String) {
        pendingChatPrompt = prompt
        selectedTab = .more
    }

    func popToRoot(_ tab: AppTab) {
        switch tab {
        case .applications: applicationsPath = NavigationPath()
        case .essays: essaysPath = NavigationPath()
        case .colleges: collegesPath = NavigationPath()
        case .profile: profilePath = NavigationPath()
        case .more: morePath = NavigationPath()
        }
    }

    func reset() {
        AppTab.allCases.forEach(popToRoot)
        selectedTab = .applications
    }

    /// Handles `collegeforge://application/<id>` and `collegeforge://tab/<name>`. Returns false for others.
    @discardableResult
    func handle(_ url: URL) -> Bool {
        guard url.scheme == AppConfig.callbackScheme else { return false }
        let parts = url.pathComponents.filter { $0 != "/" }
        switch url.host() {
        case "application":
            guard let id = parts.first, !id.isEmpty else { return false }
            openApplication(id: id)
            return true
        case "tab":
            guard let tab = parts.first.flatMap(AppTab.init(rawValue:)) else { return false }
            selectedTab = tab
            return true
        default:
            return false
        }
    }
}
