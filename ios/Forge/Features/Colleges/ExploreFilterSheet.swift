import SwiftUI

/// Sort, setting, dropdown filters and the "only show colleges that…" switches (web ExploreFilterPanel).
struct ExploreFilterSheet: View {
    @Environment(CollegesExploreModel.self) private var model
    @Environment(CollegesFavorites.self) private var favorites
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    picker("Sort by", \.sort, ExploreSort.allCases.map { ($0, $0.label) })
                }
                Section("Filter") {
                    picker("Campus setting", \.setting, ExploreFilters.settings.map { ($0.value, $0.label) })
                    ForEach(ExploreFilters.selects) { select in
                        picker(select.label, select.key, select.options.map { ($0.value, $0.label) })
                    }
                    picker("State", \.state, [("", "Any state")] + model.states.map { ($0, $0) })
                }
                Section {
                    toggle(favorites.slugs.isEmpty ? "Favorites only" : "Favorites only (\(favorites.slugs.count))", isOn: binding(\.favoritesOnly))
                    ForEach(ExploreToggle.allCases) { item in
                        toggle(item.label, isOn: Binding(
                            get: { model.filters.on.contains(item) },
                            set: { isOn in
                                if isOn != model.filters.on.contains(item) { model.filters = model.filters.toggling(item) }
                            }
                        ))
                    }
                } header: {
                    Text("Only show colleges that are")
                } footer: {
                    Text("Full need, rounds and testing come from Forge’s sourced notes on about 150 colleges, plus federal data for testing elsewhere. A school without that data won’t match those filters.")
                }
            }
            .navigationTitle("Sort & filter")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Clear all") {
                        model.filters = model.filters.cleared()
                        Haptics.selection()
                    }
                    .disabled(!model.isFiltered)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func binding<T>(_ key: WritableKeyPath<ExploreFilterState, T>) -> Binding<T> {
        Binding(get: { model.filters[keyPath: key] }, set: { model.filters = model.filters.with(key, $0) })
    }

    private func picker<T: Hashable>(_ label: String, _ key: WritableKeyPath<ExploreFilterState, T>, _ options: [(T, String)]) -> some View {
        Picker(label, selection: binding(key)) {
            ForEach(options, id: \.0) { Text($0.1).tag($0.0) }
        }
    }

    private func toggle(_ label: String, isOn: Binding<Bool>) -> some View {
        Toggle(label, isOn: isOn).tint(Theme.accent)
    }
}

/// The active filters as removable chips, above the list.
struct ExploreChipsRow: View {
    let chips: [ExploreChip]
    let remove: (ExploreChip) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.Spacing.xs) {
                ForEach(chips) { chip in
                    Button { remove(chip) } label: {
                        HStack(spacing: 4) {
                            Text(chip.label).lineLimit(1)
                            Image(systemName: "xmark").font(.caption2.weight(.bold))
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Theme.accentSoft, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove filter: \(chip.label)")
                }
            }
        }
        .scrollClipDisabled()
    }
}
