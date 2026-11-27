import SwiftUI

struct ShortlistBalanceSection: View {
    @Environment(WorkspaceStore.self) private var store
    @Environment(CollegesChancesModel.self) private var chances
    @State private var isSaving = false
    @State private var notice: String?
    @State private var error: APIError?
    @State private var lastResult: CollegesRebalanceResponse?

    private var ambition: CollegesAmbition {
        store.workspace.onboarding.listPrefs.flatMap { CollegesAmbition(rawValue: $0.ambition) } ?? .balanced
    }

    private var warnings: [String] {
        let workspace = store.workspace
        let savedGaps = chances.metadata(for: workspace)?.listGaps
        let recentGaps = lastResult.flatMap {
            $0.data.draftStorageKey == workspace.draftStorageKey && $0.data.revision == workspace.revision ? $0.gaps : nil
        }
        return CollegesShortlist.balanceWarnings(workspace.colleges) +
            (savedGaps ?? recentGaps ?? []).compactMap { $0.message(for: workspace.colleges) }
    }

    var body: some View {
        Section {
            Text("Rebalancing swaps only the schools Forge picked for you. Schools you added and priority schools stay.")
                .font(.subheadline)
            Button("More ambitious") { start(ambition.moreAmbitious) }
                .disabled(isSaving || ambition.moreAmbitious == nil)
            Button("Safer") { start(ambition.safer) }
                .disabled(isSaving || ambition.safer == nil)
            Button("Rebalance list") { start(nil) }
                .disabled(isSaving)
            ForEach(warnings, id: \.self) { warning in
                Label(warning, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(Theme.amber)
            }
            if isSaving {
                ProgressView("Saving change…")
            } else if let error {
                Text(error.message).font(.footnote).foregroundStyle(Theme.danger)
            } else if let notice {
                Text(notice).font(.footnote).foregroundStyle(Theme.body)
            }
        } header: {
            Text("List balance: \(ambition.label)").textCase(nil)
        }
    }

    private func start(_ next: CollegesAmbition?) {
        guard !isSaving else { return }
        isSaving = true
        notice = nil
        error = nil
        let scope = store.workspace.draftStorageKey
        Task {
            defer { isSaving = false }
            do {
                if let next {
                    _ = try await store.api.patchCollegeWorkspace(["listPrefs": ["ambition": .string(next.rawValue)]])
                    guard store.workspace.draftStorageKey == scope else { return }
                }
                let result = try await store.api.rebalanceCollegeList()
                guard result.data.draftStorageKey == scope, store.workspace.draftStorageKey == scope else { return }
                lastResult = result
                notice = result.summary(shiftedTo: next)
                Haptics.success()
            } catch {
                guard store.workspace.draftStorageKey == scope else { return }
                self.error = APIError.wrap(error)
                Haptics.error()
            }
            // A successful preference shift persists even if the subsequent rebalance fails.
            await store.refresh()
        }
    }
}
