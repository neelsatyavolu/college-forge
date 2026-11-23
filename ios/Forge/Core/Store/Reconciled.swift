import Foundation

/// Optimistic state for one server-owned value (the workspace, the tracker).
///
/// Screens see `displayed`. A local change applies at once and counts as in flight; server replies update
/// `confirmed` only when their revision is not older than what we have (replies can arrive out of order).
/// When nothing is in flight any more, `displayed` snaps to `confirmed`, so a failed change rolls back and
/// successful ones show exactly what the server stored.
struct Reconciled<Value: Sendable>: Sendable {
    private(set) var displayed: Value?
    private(set) var confirmed: Value?
    private(set) var inFlight = 0
    private let revision: @Sendable (Value) -> Int

    init(revision: @escaping @Sendable (Value) -> Int) {
        self.revision = revision
    }

    var isLoaded: Bool { confirmed != nil }

    /// Applies a local change and marks one request in flight. Returns false when nothing is loaded yet.
    @discardableResult
    mutating func begin(_ change: (inout Value) -> Void) -> Bool {
        guard var value = displayed else { return false }
        change(&value)
        displayed = value
        inFlight += 1
        return true
    }

    /// Marks a request in flight without a local change.
    mutating func beginWithoutChange() {
        inFlight += 1
    }

    /// Ends one in-flight request, with the server's value when it succeeded.
    mutating func finish(_ server: Value?) {
        inFlight = max(0, inFlight - 1)
        if let server { accept(server) }
        settle()
    }

    /// A value fetched outside any change (load, refresh, push).
    mutating func receive(_ server: Value) {
        accept(server)
        settle()
    }

    mutating func reset() {
        displayed = nil
        confirmed = nil
        inFlight = 0
    }

    private mutating func accept(_ server: Value) {
        if let confirmed, revision(server) < revision(confirmed) { return }
        confirmed = server
    }

    private mutating func settle() {
        if inFlight == 0 { displayed = confirmed }
    }
}
