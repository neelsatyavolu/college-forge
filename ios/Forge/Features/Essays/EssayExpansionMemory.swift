import Foundation

/// Which schools the student left expanded or collapsed on Essays, kept on this device per workspace, like the
/// web sidebar's `cf-essay-open:<draftStorageKey>` (public/hub/Essays.jsx). Schools without a saved state follow
/// the defaults in `EssayCatalog.initiallyExpanded`.
struct EssayExpansionMemory {
    let key: String
    private let defaults: UserDefaults

    init(workspaceKey: String, defaults: UserDefaults = .standard) {
        key = "forge.essays.open." + (workspaceKey.isEmpty ? "local" : workspaceKey)
        self.defaults = defaults
    }

    /// Group key → open, for the groups the student has seen.
    func saved() -> [String: Bool] {
        (defaults.dictionary(forKey: key) as? [String: Bool]) ?? [:]
    }

    /// Records the open state of every current group, keeping what was saved for groups not shown now.
    func save(open: Set<String>, groups: [String]) {
        let state = groups.reduce(into: saved()) { state, group in state[group] = open.contains(group) }
        defaults.set(state, forKey: key)
    }

    /// The defaults with the saved choices on top.
    static func initial(defaults: Set<String>, saved: [String: Bool]) -> Set<String> {
        saved.reduce(into: defaults) { open, entry in
            if entry.value { open.insert(entry.key) } else { open.remove(entry.key) }
        }
    }

    /// After the list changes: the Common App opens unless the student closed it, and a newly added school opens
    /// unless the student already chose a state for it.
    static func adding(_ newSchools: [String], to open: Set<String>, saved: [String: Bool], commonKey: String) -> Set<String> {
        var next = open
        if saved[commonKey] != false { next.insert(commonKey) }
        for key in newSchools where saved[key] == nil { next.insert(key) }
        return next
    }
}
