import SwiftUI

/// The prompt under the essay title: the question, and for choose-one prompts the options to pick from.
/// Mirrors `EssayPrompt` in public/hub/EssayChoice.jsx.
struct EssayPromptText: View {
    let essay: Essay
    /// The saved choice (`Workspace.essayOption`), 0-based.
    let chosen: Int?
    let onChoose: (Int) -> Void

    @State private var changing = false

    var body: some View {
        let parts = EssayChoiceRules.promptParts(essay)
        let options = parts.options
        let picked = chosen.flatMap { options.indices.contains($0) ? $0 : nil }
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            ForEach(Array(parts.intro.enumerated()), id: \.offset) { paragraph($0.element) }
            if options.count > 1, let picked, !changing {
                VStack(alignment: .leading, spacing: 4) {
                    label("You’re answering option \(picked + 1) of \(options.count)")
                    paragraph(options[picked])
                    Button("Change") { changing = true }.font(.subheadline)
                }
            }
            if options.count > 1 && (picked == nil || changing) {
                VStack(alignment: .leading, spacing: 6) {
                    label("Pick the one you’re answering")
                    ForEach(Array(options.enumerated()), id: \.offset) { index, option in
                        optionButton(index: index, text: option, picked: picked == index)
                    }
                }
            }
            if options.count == 1 { paragraph(options[0]) }
            ForEach(Array(parts.notes.enumerated()), id: \.offset) { note in
                Text(note.element)
                    .font(.footnote)
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func paragraph(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(Theme.body)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }

    private func label(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(Theme.muted)
    }

    private func optionButton(index: Int, text: String, picked: Bool) -> some View {
        Button {
            onChoose(index)
            changing = false
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.xs) {
                Text("\(index + 1)")
                    .font(.forgeNumber(.caption))
                    .foregroundStyle(picked ? Theme.accent : Theme.muted)
                Text(text)
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(Theme.Spacing.xs)
            .background(picked ? Theme.surface : Color.clear, in: RoundedRectangle(cornerRadius: Theme.Radius.small))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.small).stroke(picked ? Theme.accent : Theme.hairline))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Option \(index + 1): \(text)")
        .accessibilityAddTraits(picked ? .isSelected : [])
    }
}
