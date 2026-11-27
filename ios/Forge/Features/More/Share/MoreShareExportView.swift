import SwiftUI

/// Share a read-only view with a counselor or parent, read their notes, and export drafts, deadlines or a backup.
struct MoreShareExportView: View {
    @Environment(WorkspaceStore.self) private var store

    var body: some View {
        List {
            MoreParentsSection(role: .parent)
            MoreParentsSection(role: .counselor)
            MoreShareLinksSection()
            MoreExportSection()
            MoreAdvisorNotesSection()
        }
        .navigationTitle("Share & export")
        .forgeScreenBackground()
        .refreshable { await store.refresh() }
    }
}

/// The four downloads, each handed to the share sheet once ready.
private struct MoreExportSection: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var essayId = ""
    @State private var downloading: MoreExportFormat?
    @State private var exported: MoreExportedFile?
    @State private var error: APIError?

    var body: some View {
        Section {
            if !store.workspace.essays.commonApp.isEmpty {
                Picker("Essay in the pack", selection: $essayId) {
                    Text("All prompts and drafts").tag("")
                    ForEach(store.workspace.essays.commonApp) { essay in
                        Text(essay.label).tag(essay.id)
                    }
                }
            }
            ForEach(MoreExportFormat.allCases) { format in
                Button { download(format) } label: {
                    HStack(spacing: Theme.Spacing.sm) {
                        Image(systemName: format.systemImage)
                            .foregroundStyle(Theme.accent)
                            .frame(width: 28)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(format.title).foregroundStyle(Theme.ink)
                            Text(format.detail).font(.subheadline).foregroundStyle(Theme.muted)
                        }
                        Spacer()
                        if downloading == format {
                            ProgressView()
                        } else {
                            Image(systemName: "square.and.arrow.up").foregroundStyle(Theme.mutedSoft)
                        }
                    }
                }
                .disabled(downloading != nil)
            }
        } header: {
            Text("Export")
        } footer: {
            Text("Use these when filling out the Common App. School supplements are always in the pack. Calendar dates without a year use your graduation year's cycle; unclear dates are left out.")
        }
        .sheet(item: $exported) { file in
            MoreExportReadySheet(file: file)
        }
        .errorAlert($error)
    }

    private func download(_ format: MoreExportFormat) {
        downloading = format
        Task {
            do {
                // Like the web: save open essay drafts first so the export has the latest text.
                let drafts = EssayDraftQueues.queue(for: store)
                await drafts.flush()
                if drafts.hasUnsaved {
                    throw APIError.server(status: 0, message: drafts.errorMessage ?? "Some essay drafts haven't saved yet. Try again.")
                }
                exported = try await store.api.moreDownloadExport(format, essayId: essayId)
                Haptics.success()
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
            downloading = nil
        }
    }
}

/// The file is ready: say what's in it, then share or save.
private struct MoreExportReadySheet: View {
    let file: MoreExportedFile
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: Theme.Spacing.md) {
            Image(systemName: "doc.badge.arrow.up")
                .font(.system(size: 40))
                .foregroundStyle(Theme.accent)
            VStack(spacing: Theme.Spacing.xxs) {
                Text(file.url.lastPathComponent)
                    .font(.headline)
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.center)
                Text(file.message)
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
            }
            ShareLink(item: file.url) {
                Label("Save or share", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
            }
            .buttonStyle(.forgePrimary)
            Button("Done") { dismiss() }.buttonStyle(.forgeSecondary)
        }
        .padding(Theme.Spacing.lg)
        .presentationDetents([.medium])
        .presentationBackground(Theme.canvas)
    }
}

/// Notes left through share links. Deleting one removes it from the hub.
private struct MoreAdvisorNotesSection: View {
    @Environment(WorkspaceStore.self) private var store
    @State private var error: APIError?

    private var notes: [AdvisorNote] {
        store.workspace.advisorNotes.sorted { $0.createdAt > $1.createdAt }
    }

    var body: some View {
        Section {
            if notes.isEmpty {
                Text("Notes from people you share with show up here.")
                    .foregroundStyle(Theme.muted)
            }
            ForEach(notes) { note in
                MoreAdvisorNoteRow(note: note, essayLabel: essayLabel(note.essayId))
                    .swipeActions { Button("Delete", role: .destructive) { delete(note) } }
                    .contextMenu {
                        Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = note.body }
                        Button("Delete", systemImage: "trash", role: .destructive) { delete(note) }
                    }
            }
        } header: {
            Text(notes.isEmpty ? "Advisor notes" : "Advisor notes (\(notes.count))")
        }
        .errorAlert($error)
    }

    private func essayLabel(_ id: String?) -> String? {
        guard let id, !id.isEmpty else { return nil }
        return store.workspace.essays.all.first { $0.id == id }?.label ?? "an essay"
    }

    private func delete(_ note: AdvisorNote) {
        Task {
            do {
                try await store.patch(.with { $0.removeAdvisorNoteId = note.id }) {
                    $0.advisorNotes.removeAll { $0.id == note.id }
                }
            } catch {
                self.error = APIError.wrap(error)
                Haptics.error()
            }
        }
    }
}

private struct MoreAdvisorNoteRow: View {
    let note: AdvisorNote
    let essayLabel: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xxs) {
            HStack(alignment: .firstTextBaseline) {
                Text(note.author.isEmpty ? "Advisor" : note.author)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                Spacer()
                Text(note.createdDate.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
            }
            if let essayLabel {
                Text("On \(essayLabel)").font(.caption).foregroundStyle(Theme.muted)
            }
            Text(note.body)
                .font(.body)
                .foregroundStyle(Theme.body)
                .textSelection(.enabled)
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    NavigationStack { MoreShareExportView() }.previewEnvironment()
}
