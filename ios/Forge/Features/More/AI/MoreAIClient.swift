import Foundation

/// Calls for the copilot and its AI sign-ins (`/api/ai/*`, `/api/auth/{grok,codex}/*`, `/api/upload`).
/// Every reply's provider cookies are captured into the account's `MoreAICookieJar`.
struct MoreAIClient: Sendable {
    let api: APIClient
    let jar: MoreAICookieJar

    init(api: APIClient, accountEmail: String) {
        self.api = api
        self.jar = MoreAICookieJar(baseURL: api.config.baseURL, accountEmail: accountEmail)
    }

    // MARK: Status and sign-in

    func status() async throws -> MoreAIStatus {
        let data = try await send(APIRequest("GET", "/api/ai/status"))
        do { return try JSONDecoder().decode(MoreAIStatus.self, from: data) } catch { throw APIError.wrap(error) }
    }

    /// Starts a Grok or ChatGPT sign-in. Returns the provider's authorize page.
    func startSignIn(_ provider: MoreAIProvider) async throws -> URL {
        struct Reply: Decodable { var authorizeUrl: String }
        let data = try await send(APIRequest("POST", "/api/auth/\(provider.rawValue)/start"))
        guard let reply = try? JSONDecoder().decode(Reply.self, from: data),
              let url = URL(string: reply.authorizeUrl), url.scheme == "https" else {
            throw APIError.server(status: 200, message: "Couldn't start sign-in. Try again.")
        }
        return url
    }

    /// Finishes a sign-in with the callback URL (or, for Grok, the code) the provider gave back.
    func completeSignIn(_ provider: MoreAIProvider, callback: String) async throws {
        try await send(.json("POST", "/api/auth/\(provider.rawValue)/complete", ["callback": callback]))
    }

    func disconnect(_ provider: MoreAIProvider) async throws {
        try await send(APIRequest("POST", "/api/auth/\(provider.rawValue)/logout"))
    }

    // MARK: Chat

    struct ChatTurn: Encodable, Sendable {
        var role: String
        var content: String
    }

    /// Opens the NDJSON event stream for a reply (`/api/ai/chat`).
    /// `mode` is "onboarding" or "research" for the setup interview; nil is the copilot.
    func chat(_ turns: [ChatTurn], provider: MoreAIProvider?, model: String?, mode: String? = nil) async throws -> URLSession.AsyncBytes {
        var body: [String: JSONValue] = ["messages": .array(turns.map { .object(["role": .string($0.role), "content": .string($0.content)]) })]
        if let mode { body["mode"] = .string(mode) }
        if let provider {
            body["provider"] = .string(provider.rawValue)
            if let model, !model.isEmpty { body["\(provider.rawValue)Model"] = .string(model) }
        }
        let request = try attach(.json("POST", "/api/ai/chat", body, timeout: 300))
        let (bytes, response) = try await api.stream(request)
        jar.capture(response)
        return bytes
    }

    // MARK: Uploads

    struct UploadResult: Decodable, Sendable {
        struct Saved: Decodable, Hashable, Sendable {
            var name: String
            var chars: Int
        }
        var saved: [Saved]
        var errors: [String]
    }

    /// Uploads files for the copilot to read (PDF, DOCX or text, 15 MB each).
    func upload(_ files: [MoreUploadFile]) async throws -> UploadResult {
        let form = MoreMultipartForm(files: files)
        var request = APIRequest("POST", "/api/upload", body: form.body, timeout: 120)
        request.contentType = form.contentType
        let data = try await send(request)
        do { return try JSONDecoder().decode(UploadResult.self, from: data) } catch { throw APIError.wrap(error) }
    }

    // MARK: Internals

    @discardableResult
    private func send(_ request: APIRequest) async throws -> Data {
        let (data, response) = try await api.send(attach(request))
        jar.capture(response)
        try APIClient.checkEnvelope(data)
        return data
    }

    /// Adds the account's saved Grok/ChatGPT sign-in cookies, which the server keeps in cookies.
    private func attach(_ request: APIRequest) -> APIRequest {
        var r = request
        if let cookie = jar.headerValue { r.headers["Cookie"] = cookie }
        return r
    }
}

/// A file picked for the copilot.
struct MoreUploadFile: Sendable, Hashable {
    var name: String
    var mimeType: String
    var data: Data
}

/// A `multipart/form-data` body with every file under the `files` field, as /api/upload expects.
struct MoreMultipartForm: Sendable {
    let boundary: String
    let body: Data

    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    init(files: [MoreUploadFile], boundary: String = "ForgeBoundary-\(UUID().uuidString)") {
        self.boundary = boundary
        var body = Data()
        for file in files {
            let name = Self.safeFilename(file.name)
            body.append(Data("--\(boundary)\r\n".utf8))
            body.append(Data("Content-Disposition: form-data; name=\"files\"; filename=\"\(name)\"\r\n".utf8))
            body.append(Data("Content-Type: \(file.mimeType)\r\n\r\n".utf8))
            body.append(file.data)
            body.append(Data("\r\n".utf8))
        }
        body.append(Data("--\(boundary)--\r\n".utf8))
        self.body = body
    }

    /// Drops quotes, backslashes and line breaks, which would break the header.
    static func safeFilename(_ name: String) -> String {
        let blocked: Set<Unicode.Scalar> = ["\"", "\\", "\r", "\n"]
        var scalars = String.UnicodeScalarView()
        scalars.append(contentsOf: name.unicodeScalars.filter { !blocked.contains($0) })
        let cleaned = String(scalars).trimmingCharacters(in: .whitespaces)
        return cleaned.isEmpty ? "file" : cleaned
    }
}
