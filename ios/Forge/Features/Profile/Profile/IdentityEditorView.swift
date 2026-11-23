import SwiftUI

/// Edits "About you" or "GPA and SAT". Both share one draft so saving one never clears the other.
struct IdentityEditorView: View {
    enum Part { case about, academics }

    let section: Part
    @Environment(WorkspaceStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ProfileIdentityDraft()
    @State private var original = ProfileIdentityDraft()
    @State private var loaded = false
    @State private var saving = false
    @State private var error: APIError?

    var body: some View {
        Form {
            switch section {
            case .about: aboutFields
            case .academics: academicFields
            }
        }
        .navigationTitle(section == .about ? "About you" : "GPA and SAT")
        .navigationBarTitleDisplayMode(.inline)
        .forgeScreenBackground()
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if saving { ProgressView() } else {
                    Button("Save", action: save).disabled(draft == original || draft.error != nil)
                }
            }
        }
        .navigationBarBackButtonHidden(draft != original)
        .toolbar {
            if draft != original {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .onAppear {
            guard !loaded else { return }
            draft = ProfileIdentityDraft(workspace: store.workspace)
            original = draft
            loaded = true
        }
        .errorAlert($error, title: "Couldn't save")
    }

    @ViewBuilder private var aboutFields: some View {
        Section {
            ProfileLabeledField(label: "Name", text: $draft.name, prompt: "Alex Rivera")
            ProfileLabeledField(label: "High school", text: $draft.hs, prompt: "Lincoln High")
            ProfileLabeledField(label: "Grad year", text: $draft.gradYear, prompt: "2027", keyboard: .numberPad)
            ProfileLabeledField(label: "Intended major", text: $draft.intended, prompt: "Biology")
        } header: {
            Text("Basics")
        } footer: {
            if let e = ProfileRules.gradYearError(draft.gradYear) { Text(e).foregroundStyle(Theme.danger) }
        }
        Section("Details") {
            ProfileLabeledField(label: "Cycle", text: $draft.cycle, prompt: "Fall 2027")
            ProfileLabeledField(label: "Year label", text: $draft.yearLabel, prompt: "Class of 2027")
            ProfileLabeledField(label: "Location", text: $draft.location, prompt: "Austin, TX")
            ProfileLabeledField(label: "Counselor", text: $draft.counselor, prompt: "Ms. Lee")
            ProfileLabeledField(label: "Residency", text: $draft.residency, prompt: "Texas resident")
        }
    }

    @ViewBuilder private var academicFields: some View {
        Section {
            ProfileLabeledField(label: "Weighted", text: $draft.gpaWeighted, prompt: "4.25", keyboard: .decimalPad)
            ProfileLabeledField(label: "Unweighted", text: $draft.gpaUnweighted, prompt: "3.80", keyboard: .decimalPad)
        } header: {
            Text("GPA")
        } footer: {
            Text(ProfileRules.weightedGPAError(draft.gpaWeighted) ?? ProfileRules.unweightedGPAError(draft.gpaUnweighted)
                 ?? "Optional. Weighted is on a 0–6 scale, unweighted 0–4.")
                .foregroundStyle(draft.error == nil ? Theme.muted : Theme.danger)
        }
        Section {
            ProfileLabeledField(label: "SAT", text: $draft.sat, prompt: "1400", keyboard: .numberPad)
            ProfileLabeledField(label: "Note", text: $draft.satNote, prompt: "790 M / 750 EBRW")
        } header: {
            Text("SAT")
        } footer: {
            Text(ProfileRules.satError(draft.sat) ?? "Optional. A whole number from 400 to 1600. Add a note like \"Test optional\".")
                .foregroundStyle(ProfileRules.satError(draft.sat) == nil ? Theme.muted : Theme.danger)
        }
    }

    private func save() {
        saving = true
        Task {
            defer { saving = false }
            do {
                try await store.saveIdentity(draft)
                original = draft
                Haptics.success()
                dismiss()
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}

/// A form row with the label on the left and the field on the right.
struct ProfileLabeledField: View {
    let label: String
    @Binding var text: String
    var prompt = ""
    var keyboard: UIKeyboardType = .default

    var body: some View {
        LabeledContent(label) {
            TextField(label, text: $text, prompt: Text(prompt))
                .keyboardType(keyboard)
                .multilineTextAlignment(.trailing)
        }
    }
}
