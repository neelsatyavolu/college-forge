import SwiftUI

/// An editable activities and honors list, prefilled from the profile. Saving writes it to the profile, then
/// tells the AI what was saved. A resume can be uploaded instead. Mirrors `OcActivitiesTile` in ChatTiles.jsx.
struct SetupActivitiesTile: View {
    let model: SetupChatModel
    let answer: (String) -> Void
    @State private var rows: [Activity] = []
    @State private var honors: [Honor] = []
    @State private var loaded = false
    @State private var saving = false
    @State private var error: String?

    static let maxActivities = 10
    static let maxHonors = 5

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Eyebrow(text: "Activities")
            ForEach(rows.indices, id: \.self) { i in activityRow(i) }
            if rows.count < Self.maxActivities {
                Button("Add activity", systemImage: "plus") { rows.append(Activity()) }.font(.subheadline)
            }
            Eyebrow(text: "Awards and honors").padding(.top, Theme.Spacing.xs)
            ForEach(honors.indices, id: \.self) { i in honorRow(i) }
            if honors.count < Self.maxHonors {
                Button("Add honor", systemImage: "plus") { honors.append(Honor()) }.font(.subheadline)
            }
            PrimaryButton(title: "Save my list", isLoading: saving, action: save)
                .padding(.top, Theme.Spacing.xs)
            Text("Up to \(Self.maxActivities) activities and \(Self.maxHonors) honors, like the Common App. Rough is fine.")
                .font(.caption).foregroundStyle(Theme.muted)
            if let error { Text(error).font(.footnote).foregroundStyle(Theme.danger) }
            Text("Have a resume or activities list already?").font(.subheadline).foregroundStyle(Theme.body)
            SetupUploadTile(model: model, compact: true) { msg in
                answer("\(msg) It has my activities and awards; please read it and fill in my list.")
            }
        }
        .disabled(saving)
        .onAppear(perform: prefill)
    }

    private func activityRow(_ i: Int) -> some View {
        VStack(spacing: Theme.Spacing.xs) {
            HStack {
                TextField("Activity, e.g. Robotics team", text: $rows[i].name)
                Button("Remove", systemImage: "minus.circle") { rows.remove(at: i) }
                    .labelStyle(.iconOnly).foregroundStyle(Theme.muted)
                    .accessibilityLabel("Remove activity \(i + 1)")
            }
            HStack {
                TextField("Your role", text: optional($rows[i].role))
                TextField("Grades", text: optional($rows[i].years)).frame(maxWidth: 70)
                TextField("Hrs/wk", text: optional($rows[i].hpw)).keyboardType(.numberPad).frame(maxWidth: 64)
            }
            .font(.subheadline)
        }
        .textFieldStyle(.roundedBorder)
        .padding(Theme.Spacing.xs)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))
    }

    private func honorRow(_ i: Int) -> some View {
        VStack(spacing: Theme.Spacing.xs) {
            HStack {
                TextField("Award, e.g. AP Scholar", text: $honors[i].title)
                Button("Remove", systemImage: "minus.circle") { honors.remove(at: i) }
                    .labelStyle(.iconOnly).foregroundStyle(Theme.muted)
                    .accessibilityLabel("Remove honor \(i + 1)")
            }
            HStack {
                TextField("Level: School, State, National…", text: $honors[i].level)
                TextField("Year", text: optional($honors[i].year)).frame(maxWidth: 70)
            }
            .font(.subheadline)
        }
        .textFieldStyle(.roundedBorder)
        .padding(Theme.Spacing.xs)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.medium, style: .continuous))
    }

    private func optional(_ binding: Binding<String?>) -> Binding<String> {
        Binding(get: { binding.wrappedValue ?? "" }, set: { binding.wrappedValue = $0 })
    }

    /// Saved rows first, then empty ones: at least 3 activity rows and 1 honor row.
    private func prefill() {
        guard !loaded else { return }
        loaded = true
        let profile = model.store.workspace.profile
        rows = Self.padded(profile.activities, blank: Activity(), min: 3, max: Self.maxActivities)
        honors = Self.padded(profile.honors, blank: Honor(), min: 1, max: Self.maxHonors)
    }

    static func padded<T>(_ list: [T], blank: T, min: Int, max: Int) -> [T] {
        let target = Swift.min(max, Swift.max(min, list.count + 1))
        return list + Array(repeating: blank, count: Swift.max(0, target - list.count))
    }

    private func save() {
        let trim = { (s: String?) in (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
        let activities = rows.filter { !trim($0.name).isEmpty }.enumerated().map { i, a in
            var copy = a
            copy.name = trim(a.name); copy.role = trim(a.role); copy.years = trim(a.years); copy.hpw = trim(a.hpw)
            copy.rank = i + 1
            return copy
        }
        let honorList = honors.filter { !trim($0.title).isEmpty }.map { h in
            var copy = h
            copy.title = trim(h.title); copy.level = trim(h.level); copy.year = trim(h.year)
            return copy
        }
        guard !activities.isEmpty || !honorList.isEmpty else {
            error = "Add at least one activity, or tell the AI you don't have any yet."
            return
        }
        saving = true
        error = nil
        Task {
            defer { saving = false }
            do {
                var patch = WorkspacePatch()
                patch.profile = WorkspacePatch.ProfilePatch(activities: activities, honors: honorList)
                try await model.store.patch(patch)
                answer(Self.summary(activities, honorList))
            } catch {
                self.error = APIError.wrap(error).message
            }
        }
    }

    /// What the AI is told after saving.
    static func summary(_ activities: [Activity], _ honors: [Honor]) -> String {
        let line = { (a: Activity) in
            [a.name, a.role ?? "", (a.years ?? "").isEmpty ? "" : "grades \(a.years ?? "")", (a.hpw ?? "").isEmpty ? "" : "\(a.hpw ?? "") hrs/wk"]
                .filter { !$0.isEmpty }.joined(separator: ", ")
        }
        let honorLine = { (h: Honor) in [h.title, h.level, h.year ?? ""].filter { !$0.isEmpty }.joined(separator: ", ") }
        let head = "I saved my list: \(activities.count) \(activities.count == 1 ? "activity" : "activities")"
            + (honors.isEmpty ? "" : " and \(honors.count) \(honors.count == 1 ? "honor" : "honors")") + "."
        var lines = [head] + activities.enumerated().map { "\($0.offset + 1). \(line($0.element))" }
        if !honors.isEmpty { lines += ["Honors:"] + honors.map { "- \(honorLine($0))" } }
        return lines.joined(separator: "\n")
    }
}
