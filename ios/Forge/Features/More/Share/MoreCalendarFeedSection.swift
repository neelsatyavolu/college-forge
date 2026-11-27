import SwiftUI

/// The private calendar subscription (`/api/workspace/calendar`), as on the web's Share & export page.
struct CalendarFeedLink: Decodable, Equatable, Sendable {
    var https: String
    var webcal: String
    var createdAt: Double?
}

/// Subscribe in Calendar, copy the link, or replace it.
struct MoreCalendarFeedSection: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.openURL) private var openURL
    @State private var feed: CalendarFeedLink?
    @State private var loaded = false
    /// The first load failed: offer a retry, never "Make calendar link", which would replace a link that exists.
    @State private var loadFailed = false
    @State private var busy = false
    @State private var confirmingReset = false
    @State private var error: APIError?

    var body: some View {
        Section {
            if !loaded {
                ProgressView().frame(maxWidth: .infinity)
            } else if loadFailed {
                Button {
                    loaded = false
                    Task { await load() }
                } label: {
                    Label("Try again", systemImage: "arrow.clockwise")
                }
            } else if let feed {
                Button {
                    if let url = URL(string: feed.webcal) { openURL(url) }
                } label: {
                    Label("Subscribe in Calendar", systemImage: "calendar.badge.plus")
                }
                Button {
                    UIPasteboard.general.string = feed.https
                    Haptics.success()
                } label: {
                    Label("Copy link", systemImage: "doc.on.doc")
                }
                Button(role: .destructive) { confirmingReset = true } label: {
                    Label("Reset link", systemImage: "arrow.triangle.2.circlepath")
                }
                .disabled(busy)
            } else {
                Button { change("create") } label: {
                    HStack {
                        Label("Make calendar link", systemImage: "calendar.badge.plus")
                        Spacer()
                        if busy { ProgressView() }
                    }
                }
                .disabled(busy)
            }
        } header: {
            Text("Subscribe in your calendar")
        } footer: {
            Text("A private link that keeps Calendar up to date with every deadline, decision date and follow-up. Application deadlines get a reminder 3 days before. Anyone with the link can see these dates.")
        }
        .task { await load() }
        .confirmationDialog("Reset the calendar link?", isPresented: $confirmingReset, titleVisibility: .visible) {
            Button("Make a new link", role: .destructive) { change("create") }
            Button("Turn off the link", role: .destructive) { change("revoke") }
        } message: {
            Text("Calendars subscribed to the old link stop updating.")
        }
        .errorAlert($error)
    }

    private func load() async {
        do {
            feed = try await store.api.calendarFeed()
            loadFailed = false
        } catch {
            loadFailed = true
            self.error = APIError.wrap(error)
        }
        loaded = true
    }

    private func change(_ action: String) {
        busy = true
        Task {
            do {
                feed = try await store.api.calendarFeed(action)
                Haptics.success()
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
            busy = false
        }
    }
}
