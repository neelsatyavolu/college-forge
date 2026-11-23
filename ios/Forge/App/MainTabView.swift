import SwiftUI

/// The five tabs. Tapping the current tab again pops it to its root, like system apps.
struct MainTabView: View {
    @Environment(Router.self) private var router
    @Environment(WorkspaceStore.self) private var store
    @Environment(PushManager.self) private var push
    @Environment(SessionModel.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @State private var showPushPrimer = false
    @State private var lastRefresh = Date.now

    var body: some View {
        TabView(selection: tabSelection) {
            Tab(AppTab.applications.title, systemImage: AppTab.applications.systemImage, value: AppTab.applications) {
                ApplicationsView()
            }
            .badge(unopenedDecisions)
            Tab(AppTab.essays.title, systemImage: AppTab.essays.systemImage, value: AppTab.essays) {
                EssaysView()
            }
            Tab(AppTab.colleges.title, systemImage: AppTab.colleges.systemImage, value: AppTab.colleges) {
                CollegesView()
            }
            Tab(AppTab.profile.title, systemImage: AppTab.profile.systemImage, value: AppTab.profile) {
                ProfileView()
            }
            Tab(AppTab.more.title, systemImage: AppTab.more.systemImage, value: AppTab.more) {
                MoreView()
            }
        }
        .onboardingCover()
        .task { await store.loadIfNeeded() }
        .task(id: PrimerTrigger(hasApplications: !store.applications.isEmpty, onboarding: OnboardingGate.shouldPresent(store))) {
            await offerNotifications()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task {
                await push.sceneDidBecomeActive()
                await session.refreshUserIfNeeded()
            }
            // Coming back after a while: pick up portal checks that ran in the meantime.
            if Date.now.timeIntervalSince(lastRefresh) > 60 {
                lastRefresh = .now
                Task { await store.refresh() }
            }
        }
        .sheet(isPresented: $showPushPrimer) {
            PushPrimerSheet()
                .presentationDragIndicator(.visible)
        }
    }

    /// Decisions posted but not opened yet, like the count on the web's Decisions view.
    private var unopenedDecisions: Int {
        store.applications.filter { $0.decision.state == .hidden }.count
    }

    private var tabSelection: Binding<AppTab> {
        Binding(
            get: { router.selectedTab },
            set: { tab in
                if tab == router.selectedTab { router.popToRoot(tab) }
                router.selectedTab = tab
            }
        )
    }

    /// Once there's something to be notified about, explain push before the system prompt. Asked once.
    private func offerNotifications() async {
        // Not under the setup cover: the sheet couldn't show, and it is only offered once.
        guard !store.applications.isEmpty, !OnboardingGate.shouldPresent(store), !PushPrimerSheet.wasShown else { return }
        await push.refreshAuthorizationStatus()
        guard push.authorizationStatus == .notDetermined else { return }
        try? await Task.sleep(for: .seconds(1.5))
        guard !Task.isCancelled, !OnboardingGate.shouldPresent(store) else { return }
        showPushPrimer = true
    }
}

/// Re-runs the notification offer when applications appear or the setup cover goes away.
private struct PrimerTrigger: Hashable {
    let hasApplications: Bool
    let onboarding: Bool
}
