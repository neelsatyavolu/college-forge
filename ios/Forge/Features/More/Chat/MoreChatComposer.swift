import SwiftUI
import UniformTypeIdentifiers

/// The message box: attachments, text and send/stop.
struct MoreChatComposer: View {
    @Bindable var model: MoreChatModel
    let send: () -> Void
    @State private var importing = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            if let error = model.error {
                ErrorBanner(message: error, dismiss: { model.error = nil })
            }
            if !model.attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.Spacing.xs) {
                        ForEach(model.attachments, id: \.self) { file in
                            MoreAttachmentChip(name: file.name) { model.removeAttachment(file) }
                        }
                    }
                }
            }
            HStack(alignment: .bottom, spacing: Theme.Spacing.xs) {
                attachButton
                TextField(model.canSend ? "Ask, or attach files to fill your hub" : "Connect an AI to begin",
                          text: $model.input, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($focused)
                    .padding(.horizontal, Theme.Spacing.sm)
                    .padding(.vertical, 9)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
                sendButton
            }
        }
        .padding(.horizontal, Theme.Spacing.md)
        .padding(.vertical, Theme.Spacing.xs)
        .background(.bar)
        .fileImporter(isPresented: $importing, allowedContentTypes: Self.allowedTypes, allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            let (files, problems) = Self.read(urls)
            if !problems.isEmpty { model.error = problems.joined(separator: " ") }
            Task { await model.upload(files) }
        }
    }

    private var attachButton: some View {
        Button { importing = true } label: {
            Group {
                if model.isUploading { ProgressView() } else { Image(systemName: "paperclip") }
            }
            .frame(width: 36, height: 36)
        }
        .disabled(model.isUploading || model.isSending)
        .accessibilityLabel("Attach transcript, resume or other files")
    }

    @ViewBuilder
    private var sendButton: some View {
        if model.isSending {
            Button { model.stop() } label: {
                Image(systemName: "stop.circle.fill").font(.system(size: 32))
            }
            .accessibilityLabel("Stop")
        } else {
            Button {
                focused = false
                send()
            } label: {
                Image(systemName: "arrow.up.circle.fill").font(.system(size: 32))
            }
            .disabled(!model.canSend || !model.hasDraft || model.isUploading)
            .accessibilityLabel("Send")
        }
    }

    /// PDF, Word and text files, like the web's picker.
    static let allowedTypes: [UTType] = [.pdf, .plainText, .text, .json, .rtf, .html, .commaSeparatedText, .tabSeparatedText]
        + ["docx", "md"].compactMap { UTType(filenameExtension: $0) }

    static let maxBytes = 15 * 1024 * 1024

    /// Reads picked files. Returns the readable ones and a sentence for each one that wasn't.
    static func read(_ urls: [URL]) -> ([MoreUploadFile], [String]) {
        var files: [MoreUploadFile] = []
        var problems: [String] = []
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let name = url.lastPathComponent
            guard let data = try? Data(contentsOf: url) else {
                problems.append("Couldn't open \(name).")
                continue
            }
            guard data.count <= maxBytes else {
                problems.append("\(name) is too large (max 15 MB).")
                continue
            }
            let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            files.append(MoreUploadFile(name: name, mimeType: type, data: data))
        }
        return (files, problems)
    }
}

private struct MoreAttachmentChip: View {
    let name: String
    let remove: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "doc").foregroundStyle(Theme.muted)
            Text(name).lineLimit(1).truncationMode(.middle).frame(maxWidth: 180)
            Button(action: remove) { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.mutedSoft) }
                .accessibilityLabel("Remove \(name)")
        }
        .font(.footnote)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Theme.card, in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 0.5))
    }
}
