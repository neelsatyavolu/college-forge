import SwiftUI

/// One chat message. Replies render inline Markdown (bold, italics, links) and can be selected or copied.
struct MoreChatBubble: View {
    let message: MoreChatMessage

    private var isUser: Bool { message.role == .user }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 48) }
            Text(rendered)
                .font(.body)
                .foregroundStyle(isUser ? Theme.canvas : Theme.ink)
                .tint(isUser ? Theme.canvas : Theme.accent)
                .textSelection(.enabled)
                .padding(.horizontal, Theme.Spacing.sm)
                .padding(.vertical, 10)
                .background(background, in: shape)
                .overlay { if !isUser { shape.strokeBorder(Theme.hairline, lineWidth: 0.5) } }
                .contextMenu {
                    Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = message.content }
                }
            if !isUser { Spacer(minLength: 32) }
        }
        .accessibilityLabel("\(isUser ? "You" : "Copilot"): \(message.content)")
    }

    private var shape: some InsettableShape {
        RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous)
    }

    private var background: Color { isUser ? Theme.accent : Theme.card }

    private var rendered: AttributedString {
        Self.render(message.content, markdown: !isUser)
    }

    /// Inline Markdown with line breaks kept. Falls back to plain text when it doesn't parse.
    static func render(_ text: String, markdown: Bool) -> AttributedString {
        guard markdown else { return AttributedString(text) }
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }
}

#Preview {
    VStack(spacing: 12) {
        MoreChatBubble(message: .init(role: .user, content: "Which of my schools has the earliest deadline?"))
        MoreChatBubble(message: .init(role: .assistant, content: "**Rice** is first: Early Decision closes Nov 1."))
    }
    .padding()
}
