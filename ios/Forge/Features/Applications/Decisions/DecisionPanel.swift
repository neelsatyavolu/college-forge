import SwiftUI

/// A school's decision: covered until the student opens it, then the outcome, the saved letter, any merit
/// awards and buttons to record or correct the outcome. Never shows outcome text while `.hidden`.
struct DecisionPanel: View {
    let app: TrackedApplication
    /// Ids opened during this visit, so the words stay up after the list re-sorts.
    @Binding var justRevealed: Set<String>
    /// Bumped for an admit. The screen hosting the panel draws the confetti over everything, so a List row
    /// doesn't clip it.
    @Binding var celebrate: Int

    @Environment(WorkspaceStore.self) private var store
    @State private var busy = false
    @State private var error: APIError?
    @State private var readingLetter: LetterChoice?
    @State private var addedAwards: Set<Int> = []

    @State private var editingNote = false
    @State private var note = ""
    @FocusState private var noteFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            if app.decision.state == .hidden {
                cover
            } else {
                revealed
                decisionNote
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .errorAlert($error)
        .sheet(item: $readingLetter) { DecisionLetterView(app: app, letterId: $0.letterId) }
    }

    /// The server's reading of the outcome, or the app's own guess with an older server.
    private var result: AppStatus? { DecisionLogic.outcome(app.decision) }

    private var cover: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Label {
                Text("A decision is posted in the portal.").foregroundStyle(Theme.ink)
            } icon: {
                Image(systemName: "envelope.fill").foregroundStyle(Theme.coral)
            }
            .font(.body.weight(.medium))
            Text("Forge keeps it covered until you choose to open it.")
                .font(.footnote).foregroundStyle(Theme.muted)
            PrimaryButton(title: "Open decision", systemImage: "envelope.open", isLoading: busy, action: reveal)
        }
    }

    @ViewBuilder private var revealed: some View {
        let words = app.decision.portalText.isEmpty ? (result?.label ?? "") : app.decision.portalText
        let suggested = result
        if app.hasRecordedOutcome {
            HStack(spacing: Theme.Spacing.xs) {
                Image(systemName: app.status.systemImage).foregroundStyle(app.status.tone)
                Text(app.status.label).font(.forgeDisplay(.title3)).foregroundStyle(Theme.ink)
            }
            .accessibilityElement(children: .combine)
        }
        if !words.isEmpty, justRevealed.contains(app.id) || !app.hasRecordedOutcome {
            Text(words)
                .font(.forgeDisplay(.title3, weight: .regular))
                .foregroundStyle(suggested == .admitted ? Theme.success : Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .transition(.opacity.combined(with: .scale(scale: 0.96)))
        } else if words.isEmpty, !app.hasRecordedOutcome, app.letter == nil {
            Text("The portal posted a decision. Open the portal to read it.")
                .font(.subheadline).foregroundStyle(Theme.muted)
        }
        if app.decision.state == .revealed, let note = DecisionLogic.resultNote(result) {
            Text(note).font(.footnote).foregroundStyle(Theme.muted).fixedSize(horizontal: false, vertical: true)
        }
        if app.decision.state == .revealed, let letter = app.letter {
            ForEach(Array(letter.awards.enumerated()), id: \.offset) { index, award in
                AwardRow(award: award, added: addedAwards.contains(index)) { addAward(index, letterId: letter.id) }
            }
            Button { readingLetter = LetterChoice(letterId: nil) } label: { Label("Read your letter", systemImage: "envelope.open") }
                .font(.subheadline.weight(.medium))
                .buttonStyle(.borderless)
        } else if app.decision.state == .revealed, let url = app.openablePortalURL {
            Link(destination: url) { Label("Open \(app.portalName)", systemImage: "arrow.up.right.square") }
                .font(.subheadline.weight(.medium))
                .buttonStyle(.borderless)
        }
        ForEach(app.letterHistory) { old in
            Button { readingLetter = LetterChoice(letterId: old.id) } label: {
                Label("Earlier letter" + (old.result.map { ": \($0.label)" } ?? ""), systemImage: "clock.arrow.circlepath")
            }
            .font(.footnote)
            .buttonStyle(.borderless)
        }
        if !app.hasRecordedOutcome || justRevealed.contains(app.id) {
            RecordOutcomeButtons(suggested: suggested, current: app.status, disabled: busy, record: record)
        }
    }

    @ViewBuilder private var decisionNote: some View {
        if editingNote {
            DecisionNoteField(school: app.name, text: $note)
                .focused($noteFocused)
                .textFieldStyle(.roundedBorder)
                .disabled(busy)
            HStack {
                Button("Save", action: saveNote)
                    .disabled(ApplicationsValidation.trimmed(note) == app.decisionNote)
                Button("Cancel") { editingNote = false }
            }
            .buttonStyle(.borderless)
            .disabled(busy)
        } else {
            if !app.decisionNote.isEmpty { Text(app.decisionNote) }
            Button(app.decisionNote.isEmpty ? "Add a note" : "Edit note") {
                note = app.decisionNote
                editingNote = true
                noteFocused = true
            }
            .buttonStyle(.borderless)
            .disabled(busy)
        }
    }

    private func saveNote() {
        let edit = ApplicationEdit(decisionNote: ApplicationsValidation.trimmed(note))
        busy = true
        Task {
            defer { busy = false }
            do {
                try await store.updateApplication(id: app.id, edit)
                editingNote = false
                Haptics.success()
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }

    private func reveal() {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await store.revealDecision(forApplication: app.id)
                withAnimation(.smooth) { _ = justRevealed.insert(app.id) }
                let outcome = store.application(id: app.id).flatMap { DecisionLogic.outcome($0.decision) }
                if outcome == .admitted { celebrate += 1 } else { Haptics.tap() }
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }

    private func addAward(_ index: Int, letterId: String) {
        Task {
            do {
                try await store.addLetterAward(index, letterId: letterId, forApplication: app.id)
                addedAwards.insert(index)
                Haptics.success()
            } catch {
                self.error = APIError.wrap(error)
            }
        }
    }

    private func record(_ status: AppStatus) {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await store.setStatus(status, forApplication: app.id)
                if status == .admitted || status == .committed { celebrate += 1 } else { Haptics.success() }
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}

/// Which letter the sheet shows: nil for the current decision's.
private struct LetterChoice: Identifiable {
    let letterId: String?
    var id: String { letterId ?? "current" }
}

/// A merit award from the letter, one tap from the scholarships list.
private struct AwardRow: View {
    let award: DecisionAward
    let added: Bool
    let add: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(award.name).font(.subheadline.weight(.medium)).foregroundStyle(Theme.ink)
                if !award.amountText.isEmpty {
                    Text(award.amountText).font(.subheadline.monospacedDigit()).foregroundStyle(Theme.success)
                }
            }
            Spacer(minLength: Theme.Spacing.xs)
            if added {
                Label("Added", systemImage: "checkmark").font(.footnote).foregroundStyle(Theme.muted)
            } else {
                Button("Add to scholarships", action: add).buttonStyle(.bordered).controlSize(.small).tint(Theme.accent)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// "Record it:" with the suggested outcome as the filled button.
private struct RecordOutcomeButtons: View {
    let suggested: AppStatus?
    let current: AppStatus
    let disabled: Bool
    let record: (AppStatus) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text(current == suggested ? "Not right? Change it" : "Record it").font(.footnote.weight(.medium)).foregroundStyle(Theme.muted)
            FlowLayout { buttons }
        }
        .disabled(disabled)
    }

    @ViewBuilder private var buttons: some View {
        ForEach(DecisionLogic.recordOptions(suggested: suggested).filter { $0 != current }) { status in
            if status == suggested {
                Button(status.label) { record(status) }
                    .buttonStyle(.borderedProminent)
                    .tint(status.tone)
            } else {
                Button(status.label) { record(status) }
                    .buttonStyle(.bordered)
                    .tint(Theme.accent)
            }
        }
        .controlSize(.small)
        .fixedSize()
    }
}

#Preview {
    @Previewable @State var revealed: Set<String> = []
    @Previewable @State var celebrate = 0
    var app = PreviewData.tracker.apps[0]
    app.decision = DecisionView(state: .hidden)
    return List { DecisionPanel(app: app, justRevealed: $revealed, celebrate: $celebrate) }.previewEnvironment()
}
