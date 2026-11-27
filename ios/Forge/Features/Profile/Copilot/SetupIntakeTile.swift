import SwiftUI

/// The quick start: paste a summary from an AI that knows the student, upload a file, or fill in what they
/// know. Mirrors `OcIntakeTile` in public/hub/IntakeTile.jsx.
struct SetupIntakeTile: View {
    let model: SetupChatModel
    let answer: (String) -> Void
    @State private var form = SetupIntakeForm()
    @State private var loaded = false
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            SetupAgentPaste(answer: answer)
            SetupUploadTile(model: model, compact: true) { msg in
                answer("\(msg) It has my grades, activities or other details; please read it and fill in what you can.")
            }
            Text("Or fill in what you know. Skip anything you're not sure about.")
                .font(.subheadline).foregroundStyle(Theme.body)

            group("You") {
                field("Name") { TextField("Name", text: $form.name).textContentType(.name) }
                HStack(spacing: Theme.Spacing.sm) {
                    field("Class of") { TextField("2027", text: $form.gradYear).keyboardType(.numberPad) }
                    field("State") {
                        Picker("State", selection: $form.residency) {
                            Text("Choose").tag("")
                            ForEach(SetupIntakeForm.states, id: \.self) { Text($0).tag($0) }
                            Text("Outside the US").tag("INTL")
                        }
                        .pickerStyle(.menu)
                    }
                }
                field("High school") { TextField("High school", text: $form.hs) }
                field("Citizenship") { chips("citizenship", $form.citizenship) }
            }

            group("Grades and tests") {
                HStack(spacing: Theme.Spacing.sm) {
                    field("Unweighted GPA", hint: "out of 4.0") { TextField("3.8", text: $form.gpaUnweighted).keyboardType(.decimalPad) }
                    field("Weighted GPA") { TextField("4.2", text: $form.gpaWeighted).keyboardType(.decimalPad) }
                }
                field("9th grade GPA", hint: "unweighted, if you know it") { TextField("", text: $form.gpa9).keyboardType(.decimalPad) }
                HStack(spacing: Theme.Spacing.sm) {
                    field("10th grade GPA", hint: "unweighted") { TextField("", text: $form.gpa10).keyboardType(.decimalPad) }
                    field("11th grade GPA", hint: "unweighted") { TextField("", text: $form.gpa11).keyboardType(.decimalPad) }
                }
                field("10th–11th GPA", hint: "unweighted, if you know it") { TextField("", text: $form.gpaRecent).keyboardType(.decimalPad) }
                HStack(spacing: Theme.Spacing.sm) {
                    field("SAT") { TextField("", text: $form.sat).keyboardType(.numberPad).disabled(form.testOptional) }
                    field("ACT") { TextField("", text: $form.act).keyboardType(.numberPad).disabled(form.testOptional) }
                }
                Toggle("Not sending scores", isOn: $form.testOptional).font(.subheadline)
                field("My grades are") { chips("gpaTrend", $form.gpaTrend) }
            }

            group("What you want to study") {
                field("Majors you're considering", hint: "or Undecided") { TextField("Economics, maybe computer science", text: $form.intended) }
            }

            group("Campus") {
                field("Setting", hint: "pick any") { multiChips("settings", $form.settings) }
                field("Size") { chips("size", $form.size) }
                field("Regions", hint: "pick any") { multiChips("regions", $form.regions) }
                field("Anything else that matters", hint: "optional") { TextField("Strong student newspaper, near home…", text: $form.campusNotes) }
                field("Schools you already like", hint: "optional") { TextField("Northwestern, UCLA…", text: $form.likedSchools) }
            }

            group("Activities and awards") {
                field("One per line: what it is, your role, grades, hours a week", hint: "rough is fine") {
                    TextField("Student news show, co-executive producer, 9–12, 10 hrs/wk", text: $form.activities, axis: .vertical)
                        .lineLimit(3...8)
                }
            }

            group("Money") {
                Text("Colleges price by family income, so this is how Forge estimates what each school would really cost you. It stays in your workspace.")
                    .font(.caption).foregroundStyle(Theme.muted)
                field("Family income per year") { chips("incomeBracket", $form.incomeBracket) }
                field("What your family can pay per year") { chips("budget", $form.budget) }
                field("Applying for need-based aid?") { chips("needAid", $form.needAid) }
                field("First in your family to go to college?") { chips("firstGen", $form.firstGen) }
            }

            group("Your list") {
                field("Mix of schools") { chips("ambition", $form.ambition) }
                HStack(spacing: Theme.Spacing.sm) {
                    field("With supplements", hint: "all UCs = 1") {
                        TextField("6–10", text: $form.suppCount).keyboardType(.numberPad).disabled(form.recommendCounts)
                    }
                    field("No supplements") {
                        TextField("2–5", text: $form.noSuppCount).keyboardType(.numberPad).disabled(form.recommendCounts)
                    }
                }
                Toggle("Not sure: recommend for me", isOn: $form.recommendCounts).font(.subheadline)
                field("Early Decision (binding)?") { chips("ed", $form.ed) }
            }

            PrimaryButton(title: "Save and continue", isLoading: saving, action: save)
            Text("You can change any of this later in your profile.").font(.caption).foregroundStyle(Theme.muted)
            if let error { Text(error).font(.footnote).foregroundStyle(Theme.danger) }
        }
        .textFieldStyle(.roundedBorder)
        .disabled(saving)
        .onAppear {
            guard !loaded else { return }
            loaded = true
            form = SetupIntakeForm(workspace: model.store.workspace)
        }
    }

    private func group(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Eyebrow(text: title)
            content()
        }
        .padding(Theme.Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
    }

    private func field(_ label: String, hint: String? = nil, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text(label).font(.footnote.weight(.medium)).foregroundStyle(Theme.body)
                if let hint { Text(hint).font(.caption).foregroundStyle(Theme.muted) }
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// One choice; tapping the picked chip clears it.
    private func chips(_ key: String, _ value: Binding<String?>) -> some View {
        FlowLayout(spacing: Theme.Spacing.xs) {
            ForEach(SetupIntakeForm.choices[key] ?? [], id: \.label) { choice in
                SetupChip(label: choice.label, on: value.wrappedValue == choice.value) {
                    value.wrappedValue = value.wrappedValue == choice.value ? nil : choice.value
                }
            }
        }
    }

    private func multiChips(_ key: String, _ value: Binding<[String]>) -> some View {
        FlowLayout(spacing: Theme.Spacing.xs) {
            ForEach(SetupIntakeForm.choices[key] ?? [], id: \.label) { choice in
                SetupChip(label: choice.label, on: value.wrappedValue.contains(choice.value)) {
                    value.wrappedValue = SetupIntakeForm.toggled(value.wrappedValue, choice.value)
                }
            }
        }
    }

    private func save() {
        let built = form.build()
        guard !built.said.isEmpty else {
            error = "Fill in anything you know, or use one of the other ways above."
            return
        }
        saving = true
        error = nil
        Task {
            defer { saving = false }
            do {
                if !built.patch.isEmpty {
                    try await model.store.api.setupPatch(built.patch)
                    await model.store.refresh()
                }
                answer(built.message)
            } catch {
                self.error = APIError.wrap(error).message
            }
        }
    }
}

struct SetupChip: View {
    let label: String
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            Text(label)
                .font(.footnote.weight(.medium))
                .foregroundStyle(on ? Theme.canvas : Theme.ink)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(on ? Theme.accent : Theme.fill, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// "Have an AI that knows you?": copy a prompt into another assistant, paste its summary back.
private struct SetupAgentPaste: View {
    let answer: (String) -> Void
    @State private var open = false
    @State private var copied = false
    @State private var text = ""

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("Have an AI that knows you?").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
            Text("Copy this prompt into ChatGPT, Claude or another assistant, then paste its summary here. Forge fills in what it can and asks about the rest.")
                .font(.footnote).foregroundStyle(Theme.body)
            HStack(spacing: Theme.Spacing.sm) {
                Button(copied ? "Copied" : "Copy prompt", systemImage: copied ? "checkmark" : "doc.on.doc") {
                    UIPasteboard.general.string = SetupIntakeForm.agentPrompt
                    Haptics.success()
                    copied = true
                }
                .buttonStyle(.forgeSecondary)
                .fixedSize()
                Button(open ? "Hide" : "Paste a summary") { withAnimation { open.toggle() } }
                    .font(.subheadline)
            }
            if open {
                TextField("Paste what your AI wrote about you", text: $text, axis: .vertical)
                    .lineLimit(4...10)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: text) { if text.count > 7000 { text = String(text.prefix(7000)) } }
                Button("Use this summary") { answer(SetupIntakeForm.pastedSummaryMessage(text)) }
                    .buttonStyle(.forgePrimary)
                    .fixedSize()
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).count < 40)
            }
        }
        .padding(Theme.Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.large, style: .continuous))
    }
}
