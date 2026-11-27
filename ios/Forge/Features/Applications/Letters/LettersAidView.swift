import SwiftUI

/// Recommendation letters, scholarships and the FAFSA / CSS Profile checklist (public/hub/Track.jsx).
struct LettersAidView: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var editingLetter: Recommendation?
    @State private var editingScholarship: Scholarship?
    @State private var error: APIError?

    var body: some View {
        List {
            FinancialAidSection(error: $error)
            AidBySchoolSection(error: $error)
            Section {
                if store.workspace.recommendations.isEmpty {
                    Text("No recommenders yet. Add your counselor and teachers here.").foregroundStyle(Theme.muted)
                }
                ForEach(store.workspace.recommendations) { letter in
                    Button { editingLetter = letter } label: { RecommendationRow(letter: letter) }
                        .swipeActions { removeButton { removeLetter(letter) } }
                }
                Button { editingLetter = Recommendation(id: "", name: "", type: .teacher, status: .notAsked) } label: {
                    Label("Add a recommender", systemImage: "plus")
                }
            } header: {
                ApplicationsSectionHeader(title: "Recommendation letters", count: store.workspace.recommendations.count, tone: nil)
            }
            Section {
                if store.workspace.scholarships.isEmpty {
                    Text("Track external and school-specific scholarships here.").foregroundStyle(Theme.muted)
                }
                ForEach(store.workspace.scholarships) { scholarship in
                    Button { editingScholarship = scholarship } label: { ScholarshipRow(scholarship: scholarship) }
                        .swipeActions { removeButton { removeScholarship(scholarship) } }
                }
                Button { editingScholarship = Scholarship(id: "", name: "", status: .researching) } label: {
                    Label("Add a scholarship", systemImage: "plus")
                }
            } header: {
                ApplicationsSectionHeader(title: "Scholarships", count: store.workspace.scholarships.count, tone: nil)
            }
        }
        .listStyle(.insetGrouped)
        .forgeScreenBackground()
        .navigationTitle("Letters & aid")
        .refreshable { await store.refresh() }
        .sheet(item: $editingLetter) { RecommendationEditor(letter: $0) }
        .sheet(item: $editingScholarship) { ScholarshipEditor(scholarship: $0) }
        .errorAlert($error)
    }

    private func removeButton(_ action: @escaping () -> Void) -> some View {
        Button(role: .destructive, action: action) { Label("Remove", systemImage: "trash") }
    }

    private func removeLetter(_ letter: Recommendation) {
        save(.with { $0.removeRecommendationId = letter.id }) { $0.recommendations.removeAll { $0.id == letter.id } }
    }

    private func removeScholarship(_ scholarship: Scholarship) {
        save(.with { $0.removeScholarshipId = scholarship.id }) { $0.scholarships.removeAll { $0.id == scholarship.id } }
    }

    private func save(_ patch: WorkspacePatch, optimistic: @escaping (inout Workspace) -> Void) {
        Task {
            do { try await store.patch(patch, optimistic: optimistic) } catch { self.error = APIError.wrap(error) }
        }
    }
}

private struct RecommendationRow: View {
    let letter: Recommendation
    @Environment(WorkspaceStore.self) private var store

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(letter.name).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                let detail = [letter.type.label, letter.subject ?? "", letter.deadline.map { "due \(ForgeDates.short($0).isEmpty ? $0 : ForgeDates.short($0))" } ?? ""]
                    .filter { !$0.isEmpty }
                Text(detail.joined(separator: " · ")).font(.subheadline).foregroundStyle(Theme.muted)
                let receipts = LetterReceipts.receipts(for: letter, apps: store.applications, others: store.workspace.recommendations)
                if !receipts.isEmpty {
                    let received = receipts.filter { $0.state == .received }.count
                    Text("\(received) of \(receipts.count) schools show it received")
                        .font(.caption).foregroundStyle(received == receipts.count ? Theme.success : Theme.muted)
                }
            }
            Spacer()
            Badge(text: letter.status.label, tone: LettersAidTone.recommendation(letter.status))
        }
    }
}

private struct ScholarshipRow: View {
    let scholarship: Scholarship

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(scholarship.name).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                let amount = (scholarship.amount?.isEmpty == false ? scholarship.amount : nil) ?? "Amount TBD"
                let due = scholarship.deadline.map { ForgeDates.short($0).isEmpty ? $0 : ForgeDates.short($0) }
                Text(([amount] + (due.map { ["due \($0)"] } ?? [])).joined(separator: " · "))
                    .font(.subheadline).foregroundStyle(Theme.muted)
            }
            Spacer()
            Badge(text: scholarship.status.label, tone: LettersAidTone.scholarship(scholarship.status))
        }
    }
}

enum LettersAidTone {
    static func recommendation(_ status: RecommendationStatus) -> Color {
        switch status {
        case .submitted: Theme.success
        case .asked, .inProgress: Theme.amber
        default: Theme.mutedSoft
        }
    }

    static func scholarship(_ status: ScholarshipStatus) -> Color {
        switch status {
        case .won: Theme.success
        case .submitted: Theme.teal
        case .inProgress: Theme.amber
        case .lost: Theme.danger
        default: Theme.mutedSoft
        }
    }
}

#Preview {
    NavigationStack { LettersAidView() }.previewEnvironment()
}
