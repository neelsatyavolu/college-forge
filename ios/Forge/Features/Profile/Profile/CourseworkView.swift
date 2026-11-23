import SwiftUI

/// Honors, AP and planned senior-year courses. Each change saves right away.
struct CourseworkView: View {
    enum CourseGroup: String, CaseIterable, Identifiable {
        case honors, aps, senior
        var id: String { rawValue }

        var title: String {
            switch self {
            case .honors: "Honors courses"
            case .aps: "AP courses"
            case .senior: "Senior year (planned)"
            }
        }

        var placeholder: String {
            switch self {
            case .honors: "Honors Chemistry"
            case .aps: "AP Biology"
            case .senior: "AP Statistics"
            }
        }

        var keyPath: WritableKeyPath<Coursework, [String]> {
            switch self {
            case .honors: \.honors
            case .aps: \.aps
            case .senior: \.senior
            }
        }
    }

    @Environment(WorkspaceStore.self) private var store
    @State private var addingTo: CourseGroup?
    @State private var showAdd = false
    @State private var newCourse = ""
    @State private var error: APIError?

    var body: some View {
        let coursework = store.workspace.profile.coursework
        List {
            ForEach(CourseGroup.allCases) { group in
                Section(group.title) {
                    ForEach(coursework[keyPath: group.keyPath], id: \.self) { Text($0).foregroundStyle(Theme.ink) }
                        .onDelete { offsets in update(group) { $0.remove(atOffsets: offsets) } }
                        .onMove { from, to in update(group) { $0.move(fromOffsets: from, toOffset: to) } }
                    Button("Add course", systemImage: "plus") {
                        newCourse = ""
                        addingTo = group
                        showAdd = true
                    }
                }
            }
        }
        .navigationTitle("Coursework")
        .navigationBarTitleDisplayMode(.inline)
        .forgeScreenBackground()
        .toolbar { EditButton() }
        .alert(addingTo?.title ?? "", isPresented: $showAdd) {
            TextField(addingTo?.placeholder ?? "", text: $newCourse)
            Button("Cancel", role: .cancel) {}
            Button("Add") { add() }
        } message: {
            Text("Add one course. Separate lines become separate courses.")
        }
        .errorAlert($error, title: "Couldn't save")
    }

    private func add() {
        guard let group = addingTo else { return }
        let courses = ProfileRules.lines(newCourse)
        guard !courses.isEmpty else { return }
        update(group) { list in
            list.append(contentsOf: courses.filter { !list.contains($0) })
        }
    }

    private func update(_ group: CourseGroup, _ change: (inout [String]) -> Void) {
        var next = store.workspace.profile.coursework
        change(&next[keyPath: group.keyPath])
        Task {
            do { try await store.saveCoursework(next) }
            catch { self.error = APIError.wrap(error); Haptics.error() }
        }
    }
}
