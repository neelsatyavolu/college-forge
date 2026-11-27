import SwiftUI
import UniformTypeIdentifiers

/// A question the AI asked, then its tiles. The prompt is skipped when the message above already says it.
struct SetupQuestionView: View {
    let question: InterviewQuestion
    let lead: String
    let model: SetupChatModel

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            if !SetupChat.leadSays(lead, prompt: question.prompt), !question.prompt.isEmpty {
                Text(question.prompt).font(.headline).foregroundStyle(Theme.ink)
            }
            tiles
        }
        .disabled(model.busy)
    }

    private func answer(_ text: String) {
        Haptics.tap()
        Task { await model.send(text) }
    }

    @ViewBuilder private var tiles: some View {
        switch question.kind {
        case "intake": SetupIntakeTile(model: model, answer: answer)
        case "activities": SetupActivitiesTile(model: model, answer: answer)
        case "upload": SetupUploadTile(model: model, compact: false, answer: answer)
        case "number": SetupNumberTile(question: question, answer: answer)
        case "school_search": SetupSchoolSearchTile(api: model.store.api, answer: answer)
        case "confirm":
            SetupChoiceGrid(options: [.init(value: "yes", label: "Yes"), .init(value: "no", label: "No")], multi: false, answer: answer)
        default:
            SetupChoiceGrid(options: question.options, multi: question.kind == "multi", answer: answer)
        }
    }
}

/// A tappable answer tile.
struct SetupTile: View {
    let label: String
    var hint: String?
    var selected = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                if let hint, !hint.isEmpty {
                    Text(hint).font(.caption).foregroundStyle(Theme.muted)
                }
            }
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.horizontal, Theme.Spacing.sm)
            .padding(.vertical, Theme.Spacing.xs)
            .background(selected ? Theme.accentSoft : Theme.card, in: RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous)
                .strokeBorder(selected ? Theme.accent : Theme.hairline, lineWidth: selected ? 1.5 : 0.5))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Single choice answers at once; multi choice collects picks, then "Continue".
struct SetupChoiceGrid: View {
    let options: [InterviewQuestion.Option]
    let multi: Bool
    let answer: (String) -> Void
    @State private var picked: [String] = []

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: Theme.Spacing.xs)], spacing: Theme.Spacing.xs) {
                ForEach(options, id: \.self) { opt in
                    SetupTile(label: opt.label, hint: opt.hint, selected: picked.contains(opt.label)) { toggle(opt) }
                }
            }
            if multi {
                HStack {
                    Button(picked.isEmpty ? "Continue" : "Continue with \(picked.count)") { answer(picked.joined(separator: ", ")) }
                        .buttonStyle(.forgePrimary)
                        .fixedSize()
                        .disabled(picked.isEmpty)
                    Text("Pick all that apply").font(.caption).foregroundStyle(Theme.muted)
                }
            }
        }
    }

    private func toggle(_ opt: InterviewQuestion.Option) {
        guard multi else { return answer(opt.label) }
        Haptics.selection()
        if picked.contains(opt.label) { picked.removeAll { $0 == opt.label } } else { picked.append(opt.label) }
    }
}

struct SetupNumberTile: View {
    let question: InterviewQuestion
    let answer: (String) -> Void
    @State private var value = ""

    private var valid: Bool {
        guard let n = Double(value.trimmingCharacters(in: .whitespaces)), n.isFinite else { return false }
        return (question.min.map { n >= $0 } ?? true) && (question.max.map { n <= $0 } ?? true)
    }

    private var placeholder: String {
        guard let lo = question.min, let hi = question.max else { return "Number" }
        return "\(lo.formatted()) – \(hi.formatted())"
    }

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            TextField(placeholder, text: $value)
                .keyboardType(.decimalPad)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 140)
                .accessibilityLabel(question.prompt)
            Button("Send") { answer(value.trimmingCharacters(in: .whitespaces)) }
                .buttonStyle(.forgePrimary)
                .fixedSize()
                .disabled(!valid)
            Button("I don't know") { answer("I don't know it yet") }
                .font(.subheadline)
        }
    }
}

/// Uploads a transcript or resume for the AI to read.
struct SetupUploadTile: View {
    let model: SetupChatModel
    let compact: Bool
    let answer: (String) -> Void
    @State private var importing = false
    @State private var uploading = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Button { importing = true } label: {
                HStack(spacing: Theme.Spacing.sm) {
                    if uploading { ProgressView() } else { Image(systemName: "arrow.up.doc").font(.title3) }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(uploading ? "Reading your file…" : compact ? "Upload a resume or activities list" : "Upload your transcript")
                            .font(.subheadline.weight(.semibold))
                        Text("PDF, Word or text · up to 15 MB").font(.caption).foregroundStyle(Theme.muted)
                    }
                    Spacer(minLength: 0)
                }
                .foregroundStyle(Theme.ink)
                .padding(Theme.Spacing.sm)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous)
                    .strokeBorder(Theme.hairline, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            }
            .buttonStyle(.plain)
            .disabled(uploading)
            if let error { Text(error).font(.footnote).foregroundStyle(Theme.danger) }
            if !compact {
                Button("I'll type my grades instead") { answer("I don't have my transcript handy. Let's do it by hand.") }
                    .font(.subheadline)
                    .disabled(uploading)
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: MoreChatComposer.allowedTypes, allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            let (files, problems) = MoreChatComposer.read(urls)
            error = problems.isEmpty ? nil : problems.joined(separator: " ")
            guard !files.isEmpty else { return }
            Task { await upload(files) }
        }
    }

    private func upload(_ files: [MoreUploadFile]) async {
        uploading = true
        defer { uploading = false }
        do {
            let result = try await model.ai.upload(files)
            let names = result.saved.map(\.name)
            guard !names.isEmpty else {
                error = result.errors.isEmpty ? "That file couldn't be read." : result.errors.joined(separator: " · ")
                return
            }
            answer("I uploaded \(names.joined(separator: ", ")).")
        } catch {
            self.error = APIError.wrap(error).message
        }
    }
}

/// Picks schools the student already likes from the catalog.
struct SetupSchoolSearchTile: View {
    let api: APIClient
    let answer: (String) -> Void
    @State private var catalog: [CatalogSchool] = []
    @State private var query = ""
    @State private var picked: [String] = []

    private var matches: [CatalogSchool] {
        let norm = { (s: String) in s.lowercased().filter { $0.isLetter || $0.isNumber || $0 == " " } }
        let q = norm(query)
        guard q.count >= 2 else { return [] }
        return Array(catalog.filter { norm($0.name).contains(q) && !picked.contains($0.name) }.prefix(6))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            if !picked.isEmpty {
                FlowLayout(spacing: Theme.Spacing.xs) {
                    ForEach(picked, id: \.self) { name in
                        Button { picked.removeAll { $0 == name } } label: {
                            Label(name, systemImage: "xmark").labelStyle(.titleAndIcon).font(.footnote)
                        }
                        .buttonStyle(.bordered)
                        .accessibilityLabel("Remove \(name)")
                    }
                }
            }
            HStack(spacing: Theme.Spacing.sm) {
                TextField("Search schools", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.done)
                    .onSubmit { add(matches.first?.name ?? query) }
                Button(picked.isEmpty ? "None yet" : "Continue") {
                    answer(picked.isEmpty ? "None yet" : "Schools I already like: \(picked.joined(separator: "; "))")
                }
                .buttonStyle(.forgePrimary)
                .fixedSize()
            }
            ForEach(matches) { school in
                Button(school.name) { add(school.name) }
                    .font(.subheadline)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .task { catalog = (try? await api.catalog()) ?? [] }
    }

    private func add(_ name: String) {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty, !picked.contains(n) else { return }
        Haptics.selection()
        picked.append(n)
        query = ""
    }
}
