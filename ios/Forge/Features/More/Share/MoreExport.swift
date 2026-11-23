import Foundation

/// The downloads on Share & export (`GET /api/workspace/export?format=`).
enum MoreExportFormat: String, CaseIterable, Identifiable, Sendable {
    case txt, brief, ics, json

    var id: String { rawValue }

    var title: String {
        switch self {
        case .txt: "Common App pack"
        case .brief: "Counselor brief"
        case .ics: "Deadlines calendar"
        case .json: "Full backup"
        }
    }

    var detail: String {
        switch self {
        case .txt: "Paste-ready text of your profile, activities and essays"
        case .brief: "A Markdown summary for your counselor"
        case .ics: "Every dated deadline, for Calendar"
        case .json: "Everything in your hub, as JSON"
        }
    }

    var systemImage: String {
        switch self {
        case .txt: "doc.plaintext"
        case .brief: "person.text.rectangle"
        case .ics: "calendar"
        case .json: "externaldrive"
        }
    }

    var fileExtension: String { self == .brief ? "md" : rawValue }

    var fallbackFilename: String { "college-forge.\(fileExtension)" }
}

/// A downloaded export saved to a temporary file, ready to share.
struct MoreExportedFile: Identifiable, Sendable {
    let url: URL
    let message: String
    var id: URL { url }
}

enum MoreExport {
    /// The sentence shown after a download. Calendar exports say how many dates made it in.
    static func message(for format: MoreExportFormat, events: Int?, skipped: Int?) -> String {
        guard format == .ics else { return "Ready to save or share." }
        let count = events ?? 0
        var text = "Calendar has \(count) dated event\(count == 1 ? "" : "s")."
        if let skipped, skipped > 0 {
            text += " \(skipped) date\(skipped == 1 ? " was" : "s were") skipped because the date or year needs fixing. Check your timeline and graduation year."
        }
        return text
    }

    /// A file name that is safe to write: the server's suggestion without path parts, or a default.
    static func filename(suggested: String?, format: MoreExportFormat) -> String {
        let name = (suggested ?? "")
            .components(separatedBy: CharacterSet(charactersIn: "/\\:"))
            .last?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty || name.hasPrefix(".") ? format.fallbackFilename : name
    }

    /// The server's suggested file name from a `Content-Disposition` header.
    static func suggestedFilename(fromDisposition header: String?) -> String? {
        guard let header, let range = header.range(of: "filename=") else { return nil }
        let value = header[range.upperBound...].prefix { $0 != ";" }
        let trimmed = value.trimmingCharacters(in: CharacterSet(charactersIn: "\" "))
        return trimmed.isEmpty ? nil : trimmed
    }
}

extension APIClient {
    /// Downloads an export to a temporary file. `essayId` picks one Common App essay for the text pack.
    func moreDownloadExport(_ format: MoreExportFormat, essayId: String?) async throws -> MoreExportedFile {
        var query = [URLQueryItem(name: "format", value: format.rawValue)]
        if format == .txt, let essayId, !essayId.isEmpty { query.append(URLQueryItem(name: "essayId", value: essayId)) }
        let (data, response) = try await send(APIRequest("GET", "/api/workspace/export", query: query, timeout: 60))
        let name = MoreExport.filename(
            suggested: MoreExport.suggestedFilename(fromDisposition: response.value(forHTTPHeaderField: "Content-Disposition")),
            format: format
        )
        let folder = FileManager.default.temporaryDirectory.appending(path: "exports", directoryHint: .isDirectory)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appending(path: name)
            try data.write(to: url, options: [.atomic, .completeFileProtection])
            let message = MoreExport.message(
                for: format,
                events: response.value(forHTTPHeaderField: "x-calendar-events").flatMap { Int($0) },
                skipped: response.value(forHTTPHeaderField: "x-calendar-skipped").flatMap { Int($0) }
            )
            return MoreExportedFile(url: url, message: message)
        } catch {
            throw APIError.server(status: 0, message: "Couldn't save the file on this iPhone. Try again.")
        }
    }
}
