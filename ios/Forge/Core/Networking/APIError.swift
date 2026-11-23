import Foundation

/// Every error the networking layer throws. `message` is safe to show the student as-is.
enum APIError: Error, Equatable, Sendable, LocalizedError {
    /// No connection, or the request timed out.
    case offline
    /// The session ended and refreshing didn't help. The app returns to the sign-in screen.
    case signedOut
    /// The server refused with its own message (4xx with `{error}` or `{success:false}`).
    case server(status: Int, message: String)
    /// Too many requests; the server's message says when to try again.
    case rateLimited(message: String)
    /// A 5xx or an unreadable reply.
    case unavailable
    /// The reply didn't match the expected shape.
    case decoding(String)
    case cancelled

    var message: String {
        switch self {
        case .offline: "You're offline. Check your connection and try again."
        case .signedOut: "Your session ended. Sign in again."
        case .server(_, let message): message
        case .rateLimited(let message): message
        case .unavailable: "Forge isn't responding right now. Try again in a minute."
        case .decoding: "Forge sent something this version can't read. Try updating the app."
        case .cancelled: "Cancelled."
        }
    }

    var errorDescription: String? { message }

    /// Worth offering a "Try again" button.
    var isRetryable: Bool {
        switch self {
        case .offline, .unavailable, .rateLimited: true
        default: false
        }
    }

    /// Maps any error to an APIError, so callers can always show `.message`.
    static func wrap(_ error: any Error) -> APIError {
        if let api = error as? APIError { return api }
        if error is CancellationError { return .cancelled }
        if let url = error as? URLError {
            switch url.code {
            case .cancelled: return .cancelled
            case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost,
                 .cannotConnectToHost, .dataNotAllowed, .internationalRoamingOff, .dnsLookupFailed:
                return .offline
            default: return .unavailable
            }
        }
        if error is DecodingError { return .decoding(String(describing: error)) }
        return .unavailable
    }
}
