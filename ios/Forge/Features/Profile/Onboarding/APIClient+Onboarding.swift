import Foundation

/// A file saved by POST /api/upload (text extracted on the server).
struct OnboardingUpload: Decodable, Hashable, Sendable {
    var name: String
    var chars: Int
}

struct OnboardingUploadResult: Decodable, Sendable {
    var saved: [OnboardingUpload]
    var errors: [String]

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        saved = (try? c.decode([Lossy<OnboardingUpload>].self, forKey: .saved))?.compactMap(\.value) ?? []
        errors = (try? c.decode([String].self, forKey: .errors)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case saved, errors }
}

/// A local file to upload.
struct OnboardingFile: Sendable {
    var name: String
    var mimeType: String
    var data: Data
}

/// Calls the setup wizard needs that the store doesn't cover.
extension APIClient {
    /// GET /api/colleges/search?q= (College Scorecard, any U.S. college).
    func onboardingSearchColleges(_ query: String) async throws -> [College] {
        let envelope = try await get("/api/colleges/search", query: [URLQueryItem(name: "q", value: query)],
                                     as: DataEnvelope<[Lossy<College>]>.self)
        return envelope.data.compactMap(\.value)
    }

    /// POST /api/workspace/colleges: adds a must-include school (priority) and returns the saved copy.
    func onboardingAddMustInclude(_ college: College) async throws -> College {
        var c = college
        c.priority = true
        let ws = try await post("/api/workspace/colleges", body: ["college": c], as: DataEnvelope<Workspace>.self).data
        return ws.colleges.first { $0.slug == c.slug } ?? c
    }

    /// DELETE /api/workspace/colleges?slug=
    func onboardingRemoveCollege(slug: String) async throws {
        try await send(APIRequest("DELETE", "/api/workspace/colleges", query: [URLQueryItem(name: "slug", value: slug)]))
    }

    /// POST /api/upload as multipart/form-data, field "files". Max 15 MB each on the server.
    func onboardingUpload(_ files: [OnboardingFile]) async throws -> OnboardingUploadResult {
        let boundary = "ForgeBoundary-\(UUID().uuidString)"
        var request = APIRequest("POST", "/api/upload", body: OnboardingMultipart.body(files, boundary: boundary), timeout: 120)
        request.contentType = "multipart/form-data; boundary=\(boundary)"
        return try await decode(OnboardingUploadResult.self, from: request)
    }
}

enum OnboardingMultipart {
    static func body(_ files: [OnboardingFile], boundary: String) -> Data {
        var data = Data()
        for file in files {
            let safeName = file.name.replacingOccurrences(of: "\"", with: "'").replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
            data.append(Data("--\(boundary)\r\n".utf8))
            data.append(Data("Content-Disposition: form-data; name=\"files\"; filename=\"\(safeName)\"\r\n".utf8))
            data.append(Data("Content-Type: \(file.mimeType)\r\n\r\n".utf8))
            data.append(file.data)
            data.append(Data("\r\n".utf8))
        }
        data.append(Data("--\(boundary)--\r\n".utf8))
        return data
    }
}
