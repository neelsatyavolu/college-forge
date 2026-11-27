import Foundation
import Observation

/// Unsaved essay text for one workspace, kept on disk until the server confirms it.
///
/// Same rules as the web hub's draft queue (public/hub/Essays.jsx):
/// - every keystroke goes into `pending` and is journaled to disk;
/// - after a short pause all pending drafts go up in one `PATCH {essayDrafts}`;
/// - a draft leaves `pending` only if it still matches what was sent, so typing during a save is never lost;
/// - only one save runs at a time; anything typed meanwhile is sent right after;
/// - a queue never saves into a workspace other than the one it belongs to (`isCurrent`).
@MainActor
@Observable
final class EssayDraftQueue {
    enum SaveState: Equatable { case saved, saving, failed }

    let key: String
    private(set) var pending: [String: String]
    private(set) var isSaving = false
    private(set) var errorMessage: String?
    /// True when the disk copy can't be written, so unsaved text exists only in memory.
    private(set) var storageUnavailable = false

    @ObservationIgnored private let journal: EssayDraftJournal?
    @ObservationIgnored private let debounce: Duration
    @ObservationIgnored private var flushWaiters: [CheckedContinuation<Void, Never>] = []
    @ObservationIgnored private var debounceTask: Task<Void, Never>?
    @ObservationIgnored var save: (([String: String]) async throws -> Void)?
    @ObservationIgnored var isCurrent: () -> Bool = { true }

    init(key: String, journal: EssayDraftJournal?, debounce: Duration = .milliseconds(600)) {
        self.key = key
        self.journal = journal
        self.debounce = debounce
        if let journal {
            switch journal.load() {
            case .success(let drafts): pending = drafts
            case .failure: pending = [:]; storageUnavailable = true
            }
        } else {
            pending = [:]
        }
    }

    var state: SaveState {
        if errorMessage != nil { return .failed }
        return pending.isEmpty && !isSaving ? .saved : .saving
    }

    var hasUnsaved: Bool { !pending.isEmpty }

    /// The text to show: unsaved local text, else the server's draft, else the prompt's starter.
    func text(for essay: Essay, serverDrafts: [String: String]) -> String {
        pending[essay.id] ?? serverDrafts[essay.id] ?? essay.starter ?? ""
    }

    /// Records a keystroke and schedules a save.
    func edit(id: String, text: String) {
        pending[id] = text
        errorMessage = nil
        writeJournal()
        debounceTask?.cancel()
        let delay = debounce
        debounceTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled, let self else { return }
            // Detach from the debounce handle so a later keystroke can't cancel this save mid-request.
            self.debounceTask = nil
            await self.flush()
        }
    }

    /// Joins an in-flight save so actions that read the draft on the hub can wait for it.
    func flush() async {
        debounceTask?.cancel()
        debounceTask = nil
        if isSaving {
            await withCheckedContinuation { flushWaiters.append($0) }
            return
        }
        guard let save, isCurrent(), !pending.isEmpty else { return }
        isSaving = true
        defer {
            isSaving = false
            for waiter in flushWaiters { waiter.resume() }
            flushWaiters.removeAll()
        }
        errorMessage = nil
        do {
            while isCurrent(), !pending.isEmpty {
                let sent = pending
                try await save(sent)
                for (id, text) in sent where pending[id] == text {
                    pending[id] = nil
                }
                writeJournal()
            }
        } catch {
            let apiError = APIError.wrap(error)
            // A cancelled request isn't a failure; the text stays pending for the next flush.
            if apiError != .cancelled { errorMessage = apiError.message }
        }
    }

    private func writeJournal() {
        guard let journal else {
            storageUnavailable = true
            return
        }
        storageUnavailable = !journal.write(pending)
    }
}

/// The on-disk recovery copy for one workspace's unsaved drafts (Application Support, file-protected).
struct EssayDraftJournal: Sendable {
    let url: URL

    init(url: URL) { self.url = url }

    /// The default location for a workspace's draft key, or nil if the key is unusable.
    init?(key: String, directory: URL? = nil) {
        let safe = key.filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
        guard !safe.isEmpty, safe.count <= 128 else { return nil }
        let base = directory ?? URL.applicationSupportDirectory.appending(path: "EssayRecovery", directoryHint: .isDirectory)
        url = base.appending(path: "\(safe).json")
    }

    func load() -> Result<[String: String], Error> {
        guard FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) else { return .success([:]) }
        do {
            return .success(try JSONDecoder().decode([String: String].self, from: Data(contentsOf: url)))
        } catch {
            return .failure(error)
        }
    }

    /// Writes or removes the file. Returns false when the disk copy couldn't be kept.
    @discardableResult
    func write(_ drafts: [String: String]) -> Bool {
        do {
            if drafts.isEmpty {
                if FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) {
                    try FileManager.default.removeItem(at: url)
                }
                return true
            }
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(drafts)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            return true
        } catch {
            return false
        }
    }
}

/// One queue per workspace for the life of the app, so unsaved text survives leaving the screen.
@MainActor
enum EssayDraftQueues {
    private static var queues: [String: EssayDraftQueue] = [:]

    static func queue(for store: WorkspaceStore) -> EssayDraftQueue {
        let key = store.workspace.draftStorageKey
        if let existing = queues[key] { return existing }
        let queue = EssayDraftQueue(key: key, journal: EssayDraftJournal(key: key))
        queue.isCurrent = { [weak store] in store.map { $0.hasLoaded && $0.workspace.draftStorageKey == key } ?? false }
        queue.save = { [weak store] drafts in
            guard let store else { return }
            try await store.patch(.with { $0.essayDrafts = drafts }) { ws in
                ws.essayDrafts.merge(drafts) { _, new in new }
            }
        }
        queues[key] = queue
        return queue
    }
}
