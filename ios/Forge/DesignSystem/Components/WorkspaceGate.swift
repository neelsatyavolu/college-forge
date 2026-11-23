import SwiftUI

/// Shows a spinner during the first load and a full-screen retry if it failed; otherwise the content.
/// Wrap each tab's root in it so screens can assume `store.workspace` and `store.tracker` are loaded.
///
///     WorkspaceGate { EssaysList() }
struct WorkspaceGate<Content: View>: View {
    @Environment(WorkspaceStore.self) private var store
    @ViewBuilder var content: Content

    var body: some View {
        Group {
            if store.hasLoaded {
                content
            } else if case .failed(let error) = store.phase {
                ErrorStateView(error: error) { await store.loadIfNeeded() }
            } else {
                LoadingView()
            }
        }
        .task { await store.loadIfNeeded() }
    }
}
