import SwiftUI
import UniformTypeIdentifiers

/// Optional uploads: a transcript, resume, activities list or award list, saved to the hub.
struct OnboardingDocumentsStep: View {
    @Environment(WorkspaceStore.self) private var store
    @Binding var uploads: [OnboardingUpload]
    @State private var picking = false
    @State private var uploading = false
    @State private var problems: [String] = []
    @State private var error: APIError?

    static let maxBytes = 15 * 1024 * 1024
    static let types: [UTType] = [.pdf, .plainText, .commaSeparatedText, .json]
        + ["docx", "md"].compactMap { UTType(filenameExtension: $0) }

    var body: some View {
        Form {
            Section {
                Text("Save an unofficial transcript, a resume, or an activities or awards list for reference. You can skip this.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.body)
                Button {
                    picking = true
                } label: {
                    HStack {
                        Label(uploading ? "Uploading…" : "Choose files", systemImage: "doc.badge.plus")
                        Spacer()
                        if uploading { ProgressView() }
                    }
                }
                .disabled(uploading)
            } footer: {
                Text("PDF, DOCX or text, up to 15 MB each.")
            }

            if !problems.isEmpty {
                Section {
                    ForEach(problems, id: \.self) { Text($0).foregroundStyle(Theme.danger) }
                }
            }

            if !uploads.isEmpty {
                Section("Saved") {
                    ForEach(uploads, id: \.name) { file in
                        Label {
                            LabeledContent(file.name, value: file.chars > 0 ? "\(file.chars.formatted()) chars" : "")
                        } icon: {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success)
                        }
                    }
                }
            }
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: Self.types, allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls): upload(urls)
            case .failure: problems = ["Couldn't open that file."]
            }
        }
        .errorAlert($error, title: "Upload failed")
    }

    private func upload(_ urls: [URL]) {
        let (files, skipped) = Self.read(urls)
        problems = skipped
        guard !files.isEmpty else { return }
        uploading = true
        Task {
            defer { uploading = false }
            do {
                let result = try await store.api.onboardingUpload(files)
                let names = Set(result.saved.map(\.name))
                uploads = uploads.filter { !names.contains($0.name) } + result.saved
                problems += result.errors
                if !result.saved.isEmpty { Haptics.success() }
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }

    /// Reads picked files, skipping ones that are too large or unreadable.
    private static func read(_ urls: [URL]) -> ([OnboardingFile], [String]) {
        var files: [OnboardingFile] = []
        var skipped: [String] = []
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let name = url.lastPathComponent
            guard let data = try? Data(contentsOf: url) else { skipped.append("\(name) couldn't be read."); continue }
            guard data.count <= maxBytes else { skipped.append("\(name) is too large (max 15 MB)."); continue }
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            files.append(OnboardingFile(name: name, mimeType: mime, data: data))
        }
        return (files, skipped)
    }
}
