import SwiftUI

/// A school's decision: covered until the student opens it, then the portal's words and buttons to record
/// the outcome. Never shows outcome text while the decision is `.hidden`.
struct DecisionPanel: View {
    let app: TrackedApplication
    /// Ids opened during this visit, so the words stay up after the list re-sorts.
    @Binding var justRevealed: Set<String>

    @Environment(WorkspaceStore.self) private var store
    @State private var busy = false
    @State private var error: APIError?
    @State private var celebrate = 0

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
        .overlay { CelebrationBurst(trigger: celebrate) }
        .errorAlert($error)
    }

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
        let words = app.decision.portalText
        let suggested = DecisionLogic.guess(words)
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
        } else if words.isEmpty, !app.hasRecordedOutcome {
            Text("The portal posted a decision. Open the portal to read it.")
                .font(.subheadline).foregroundStyle(Theme.muted)
        }
        if words.isEmpty, !app.hasRecordedOutcome, let url = URL(string: app.portalUrl), ApplicationDraft.isHTTPS(app.portalUrl) {
            Link(destination: url) { Label("Open \(app.portalName)", systemImage: "arrow.up.right.square") }
                .font(.subheadline.weight(.medium))
                .buttonStyle(.borderless)
        }
        if app.status != suggested, !app.hasRecordedOutcome || justRevealed.contains(app.id) {
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
                let words = store.application(id: app.id)?.decision.portalText ?? ""
                if DecisionLogic.guess(words) == .admitted { celebrate += 1 } else { Haptics.tap() }
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
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

/// "Record it:" with the suggested outcome as the filled button.
private struct RecordOutcomeButtons: View {
    let suggested: AppStatus?
    let current: AppStatus
    let disabled: Bool
    let record: (AppStatus) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text("Record it").font(.footnote.weight(.medium)).foregroundStyle(Theme.muted)
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
    var app = PreviewData.tracker.apps[0]
    app.decision = DecisionView(state: .hidden)
    return List { DecisionPanel(app: app, justRevealed: $revealed) }.previewEnvironment()
}
