import WidgetKit

struct ForgeEntry: TimelineEntry {
    let date: Date
    /// Nil when the student isn't signed in on this phone (or hasn't opened the app since installing).
    let snapshot: WidgetSnapshot?
}

/// One timeline for every Forge widget: the snapshot the app last wrote, re-dated at each of the next
/// seven midnights so "due tomorrow" turns into "due today" without the app. The app reloads the
/// timelines whenever its data changes.
struct ForgeProvider: TimelineProvider {
    func placeholder(in context: Context) -> ForgeEntry {
        ForgeEntry(date: .now, snapshot: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (ForgeEntry) -> Void) {
        let stored = WidgetSnapshotStore.load()
        // The gallery shows the student's own schools when there are some, otherwise made-up ones.
        let preview = stored.flatMap { $0.apps.isEmpty ? nil : $0 } ?? .sample
        completion(ForgeEntry(date: .now, snapshot: context.isPreview ? preview : stored))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ForgeEntry>) -> Void) {
        let snapshot = WidgetSnapshotStore.load()
        let now = Date.now
        let calendar = Calendar.current
        let midnights = (1...7).compactMap { day in
            calendar.date(byAdding: .day, value: day, to: calendar.startOfDay(for: now))
        }
        let entries = [ForgeEntry(date: now, snapshot: snapshot)]
            + midnights.map { ForgeEntry(date: $0.addingTimeInterval(60), snapshot: snapshot) }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}
