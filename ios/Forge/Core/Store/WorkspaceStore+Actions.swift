import Foundation

/// Ready-made optimistic writes for the most common changes. Each mirrors what the web hub does and throws
/// `APIError` on failure (the change is already rolled back by then).
extension WorkspaceStore {
    // MARK: Applications

    /// Edits one application (status, round, dates, notes...).
    func updateApplication(id: String, _ edit: ApplicationEdit) async throws {
        try await perform(.update(id: id, edit: edit)) { tracker in
            guard let i = tracker.apps.firstIndex(where: { $0.id == id }) else { return }
            tracker.apps[i].apply(edit)
        }
    }

    func setStatus(_ status: AppStatus, forApplication id: String) async throws {
        try await updateApplication(id: id, ApplicationEdit(status: status))
    }

    func removeApplication(id: String) async throws {
        try await perform(.remove(id: id)) { tracker in
            tracker.apps.removeAll { $0.id == id }
        }
    }

    /// Opens a posted decision. The reply carries the revealed status text.
    func revealDecision(forApplication id: String) async throws {
        try await perform(.reveal(id: id))
    }

    func setFollowUp(_ followUpID: String, done: Bool, inApplication id: String) async throws {
        try await perform(.followUpSet(id: id, followUpId: followUpID, done: done)) { tracker in
            guard let i = tracker.apps.firstIndex(where: { $0.id == id }) else { return }
            if done { tracker.apps[i].followUps.removeAll { $0.id == followUpID } }
        }
    }

    func resolveFlag(_ flagID: String) async throws {
        try await perform(.flagResolve(flagId: flagID)) { tracker in
            tracker.flags.removeAll { $0.id == flagID }
        }
    }

    // MARK: Workspace

    /// Saves one essay draft. Debounce typing in the editor (about a second) before calling this.
    func saveEssayDraft(id: String, text: String) async throws {
        try await patch(.with { $0.essayDraft = .init(id: id, text: text) }) { ws in
            ws.essayDrafts[id] = text
        }
    }

    /// Merges changes into one shortlist college (matched by slug).
    func updateCollege(_ college: College) async throws {
        try await patch(.with { $0.collegePatch = college }) { ws in
            guard let i = ws.colleges.firstIndex(where: { $0.slug == college.slug }) else { return }
            ws.colleges[i] = college
        }
    }

    /// Replaces the shortlist (add, remove or reorder). The server also syncs supplement essays.
    func setColleges(_ colleges: [College]) async throws {
        try await patch(.with { $0.colleges = colleges }) { ws in
            ws.colleges = colleges
        }
    }

    func togglePlannerTask(_ key: String, done: Bool) async throws {
        try await patch(.with { $0.plannerToggle = .init(key: key, done: done) }) { ws in
            ws.plannerDone[key] = done
        }
    }
}

extension TrackedApplication {
    /// Applies an edit locally the way the server will, for optimistic display.
    mutating func apply(_ edit: ApplicationEdit) {
        if let status = edit.status {
            self.status = status
            statusLabel = status.label
            stage = status.stage
        }
        if let round = edit.round { self.round = round; roundFromPortal = false }
        if let deadline = edit.deadline { self.deadline = deadline }
        if let notes = edit.notes { self.notes = notes }
        if let decisionNote = edit.decisionNote { self.decisionNote = decisionNote }
        if let portalUrl = edit.portalUrl { self.portalUrl = portalUrl }
        if let name = edit.name, !name.isEmpty { self.name = name }
        if let submittedAt = edit.submittedAt { self.submittedAt = submittedAt }
        if let decisionDate = edit.decisionDate {
            self.decisionDate = decisionDate.isEmpty ? nil : KeyDate(date: decisionDate, kind: "Decision", estimated: false)
        }
        if let testing = edit.testing, let plan = testingPlan {
            let choice = plan.choice.applying(testing)
            testingPlan?.choice = choice
            testingPlan?.needsScoreSend = choice.plan == .send && choice.method == .official && (choice.officialSent ?? "").isEmpty
        }
    }
}
