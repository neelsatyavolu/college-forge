import Foundation
import Observation

struct MoreChatMessage: Identifiable, Hashable, Sendable {
    enum Role: String, Sendable { case user, assistant }
    let id = UUID()
    var role: Role
    var content: String
}

/// The copilot conversation, provider status and attachments. Owned by the More tab so a chat survives
/// navigating away and back.
@MainActor
@Observable
final class MoreChatModel {
    private(set) var messages: [MoreChatMessage] = []
    private(set) var status: MoreAIStatus?
    private(set) var statusError: String?
    private(set) var isLoadingStatus = false
    private(set) var isSending = false
    private(set) var isUploading = false
    /// The progress line under the reply while it streams.
    private(set) var progress = ""
    private(set) var attachments: [MoreAIClient.UploadResult.Saved] = []
    var input = ""
    var error: String?
    var preferences = MoreAIPreferences.load() {
        didSet { preferences.save() }
    }

    @ObservationIgnored private var client: MoreAIClient?
    @ObservationIgnored private var sendTask: Task<Void, Never>?

    var canSend: Bool { preferences.canSend(with: status) }
    var headerLabel: String {
        status == nil && statusError != nil && !isLoadingStatus ? "Couldn't check" : preferences.headerLabel(for: status)
    }
    var hasDraft: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty
    }

    /// Points the model at the signed-in account. Switching accounts starts fresh.
    func configure(api: APIClient, accountEmail: String) {
        if accountKey == accountEmail, client?.api === api { return }
        if accountKey != accountEmail { reset() }
        accountKey = accountEmail
        client = MoreAIClient(api: api, accountEmail: accountEmail)
    }

    @ObservationIgnored private var accountKey = ""

    /// No known account (offline launch, signed out): drop the client so no AI cookies are sent.
    func disconnect() {
        reset()
        client = nil
        accountKey = ""
    }

    var ai: MoreAIClient? { client }

    // MARK: Status

    @discardableResult
    func loadStatus() async -> MoreAIStatus? {
        guard let client else { return nil }
        isLoadingStatus = true
        defer { isLoadingStatus = false }
        do {
            let fresh = try await client.status()
            status = fresh
            statusError = fresh.connectionErrorText
            return fresh
        } catch {
            status = nil
            statusError = "Couldn't check AI connections. \(APIError.wrap(error).message)"
            return nil
        }
    }

    // MARK: Attachments

    func upload(_ files: [MoreUploadFile]) async {
        guard let client, !files.isEmpty else { return }
        error = nil
        isUploading = true
        defer { isUploading = false }
        do {
            let result = try await client.upload(files)
            attachments += result.saved
            if !result.errors.isEmpty { error = result.errors.joined(separator: " · ") }
        } catch {
            self.error = APIError.wrap(error).message
        }
    }

    func removeAttachment(_ attachment: MoreAIClient.UploadResult.Saved) {
        attachments.removeAll { $0 == attachment }
    }

    // MARK: Sending

    /// Sends `text` (or the composer's text). `onFinish` runs after any reply that reached the server, so the
    /// caller can reload the workspace the copilot may have changed.
    func send(_ text: String? = nil, onFinish: @escaping @MainActor () async -> Void) {
        let typed = (text ?? input).trimmingCharacters(in: .whitespacesAndNewlines)
        guard let client, !isSending, !isUploading, !typed.isEmpty || !attachments.isEmpty else { return }
        isSending = true
        error = nil
        progress = "Checking connection…"
        let sentAttachments = attachments
        sendTask = Task {
            let submitted = await run(client: client, typed: typed, files: sentAttachments)
            isSending = false
            progress = ""
            if submitted { await onFinish() }
        }
    }

    /// Stops the reply in progress. What arrived so far stays.
    func stop() {
        sendTask?.cancel()
    }

    func clear() {
        guard !isSending else { return }
        messages = []
        error = nil
    }

    private func reset() {
        sendTask?.cancel()
        messages = []
        attachments = []
        input = ""
        error = nil
        status = nil
    }

    /// Returns whether the message reached the server.
    private func run(client: MoreAIClient, typed: String, files: [MoreAIClient.UploadResult.Saved]) async -> Bool {
        var submitted = false
        var restored = false
        do {
            guard let fresh = await loadStatus() else {
                throw MoreChatError("Couldn't check AI connections. Try again.")
            }
            let chosen = preferences.chosen(in: fresh)
            guard let chosen, fresh.isAvailable(chosen) else {
                throw MoreChatError("\(chosen?.label ?? "AI") isn't available. Connect it in AI providers or choose Auto. Your message wasn't sent.")
            }
            let content = Self.outgoingText(typed: typed, files: files.map(\.name))
            let history = messages.filter { !$0.content.isEmpty }.map { MoreAIClient.ChatTurn(role: $0.role.rawValue, content: $0.content) }
            messages.append(MoreChatMessage(role: .user, content: content))
            messages.append(MoreChatMessage(role: .assistant, content: ""))
            input = ""
            attachments = []
            progress = "Thinking…"
            submitted = true
            let bytes = try await client.chat(
                history + [.init(role: "user", content: content)],
                provider: preferences.preferred,
                model: preferences.model(for: chosen, in: fresh)
            )
            try await consume(bytes)
        } catch {
            let stopped = !(error is MoreChatError) && APIError.wrap(error) == .cancelled
            if !stopped {
                let message = (error as? MoreChatError)?.message ?? APIError.wrap(error).message
                self.error = submitted ? "\(message) Your message is back in the box to edit or resend." : message
                if input.isEmpty { input = typed }
                if attachments.isEmpty { attachments = files }
                restored = true
            }
        }
        if let last = messages.last, last.role == .assistant, last.content.isEmpty {
            messages.removeLast()
            // Nothing came back and the text is in the composer again: don't keep a second copy above it.
            if restored, messages.last?.role == .user { messages.removeLast() }
        }
        return submitted
    }

    private func consume(_ bytes: URLSession.AsyncBytes) async throws {
        var finished = false
        for try await line in bytes.lines {
            guard let event = MoreChatEvent.parse(line) else { continue }
            switch event {
            case .delta(let text): appendToReply(text)
            case .status(let message): progress = message
            case .tool(let name, let path): progress = MoreChatStatus.tool(name, path: path)
            case .error(let message): throw MoreChatError(message)
            case .done: finished = true
            case .other: break
            }
        }
        try Task.checkCancellation()
        if !finished { throw MoreChatError("The connection ended before the reply finished.") }
    }

    private func appendToReply(_ text: String) {
        guard let index = messages.indices.last, messages[index].role == .assistant else { return }
        messages[index].content += text
    }

    /// What the server receives for a message with attachments, matching the web.
    nonisolated static func outgoingText(typed: String, files: [String]) -> String {
        guard !files.isEmpty else { return typed }
        let list = files.joined(separator: ", ")
        if typed.isEmpty { return "I uploaded \(list). Please read them and populate my hub." }
        return "\(typed)\n\n(Attached files: \(list) — read them and update my hub.)"
    }
}

struct MoreChatError: Error {
    let message: String
    init(_ message: String) { self.message = message }
}
