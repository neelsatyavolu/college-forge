import Foundation

/// Screens pushed on the Profile tab's stack.
enum ProfileRoute: Hashable {
    case about, academics, apScores, coursework, activities, honors, deadlines, readiness
}

/// Where a readiness item leads: an editor here, or another tab.
enum ProfileReadinessTarget: Hashable {
    case route(ProfileRoute)
    case tab(AppTab)
}

/// One line of the readiness checklist.
struct ProfileReadinessItem: Hashable, Identifiable {
    let id: String
    let title: String
    let detail: String
    let isDone: Bool
    let target: ProfileReadinessTarget
}

/// How complete the student's application materials are. A plain checklist, not a score of the student.
struct ProfileReadiness {
    let items: [ProfileReadinessItem]

    var doneCount: Int { items.filter(\.isDone).count }
    var progress: Double { items.isEmpty ? 0 : Double(doneCount) / Double(items.count) }
    var nextItem: ProfileReadinessItem? { items.first { !$0.isDone } }

    init(workspace ws: Workspace) {
        let p = ws.profile
        let a = ws.applicant
        var items: [ProfileReadinessItem] = []

        let basics = [a.name, p.hs, p.intended].allSatisfy { !$0.profileTrimmed.isEmpty }
            && !(p.gradYear.profileTrimmed.isEmpty && a.cycle.profileTrimmed.isEmpty)
        items.append(.init(id: "basics", title: "About you", detail: basics ? p.intended : "Name, school, major and class year",
                           isDone: basics, target: .route(.about)))

        let gpa = a.gpaWeighted.isPresentStat || a.gpaUnweighted.isPresentStat
        let gpaText = [a.gpaWeighted.isPresentStat ? "\(a.gpaWeighted) W" : nil, a.gpaUnweighted.isPresentStat ? "\(a.gpaUnweighted) UW" : nil]
            .compactMap { $0 }.joined(separator: " · ")
        items.append(.init(id: "gpa", title: "GPA", detail: gpa ? gpaText : "At least one GPA",
                           isDone: gpa, target: .route(.academics)))

        let overLimit = p.activities.filter { ($0.desc ?? "").count > ProfileRules.descriptionLimit }.count
        let activitiesDone = !p.activities.isEmpty && overLimit == 0
        let activityDetail = overLimit > 0
            ? "\(overLimit) over \(ProfileRules.descriptionLimit) characters"
            : "\(p.activities.count) of \(ProfileRules.maxActivities)"
        items.append(.init(id: "activities", title: "Activities", detail: activityDetail,
                           isDone: activitiesDone, target: .route(.activities)))

        items.append(.init(id: "honors", title: "Honors", detail: "\(p.honors.count) of \(ProfileRules.maxHonors)",
                           isDone: !p.honors.isEmpty, target: .route(.honors)))

        let courses = p.coursework.honors.count + p.coursework.aps.count + p.coursework.senior.count
        items.append(.init(id: "coursework", title: "Coursework", detail: courses == 0 ? "Honors, AP and senior-year classes" : "\(courses) course\(courses == 1 ? "" : "s")",
                           isDone: courses > 0, target: .route(.coursework)))

        items.append(.init(id: "colleges", title: "College list", detail: ws.colleges.isEmpty ? "No schools yet" : "\(ws.colleges.count) school\(ws.colleges.count == 1 ? "" : "s")",
                           isDone: !ws.colleges.isEmpty, target: .tab(.colleges)))

        // Supplements of schools the student turned off on Essays aren't part of the work.
        let essays = ws.essays.commonApp + ws.essays.supplements.keys.sorted().flatMap { slug -> [Essay] in
            let key = ws.colleges.first { $0.slug == slug }.flatMap(EssayCatalog.groupKey(for:)) ?? slug
            let off = EssayCatalog.isSkipped(slug, essaySchools: ws.essaySchools) || EssayCatalog.isSkipped(key, essaySchools: ws.essaySchools)
            return off ? [] : ws.essays.supplements[slug] ?? []
        }
        let drafted = essays.filter { !(ws.essayDrafts[$0.id] ?? "").profileTrimmed.isEmpty }.count
        items.append(.init(id: "essays", title: "Essays", detail: essays.isEmpty ? "No prompts yet" : "\(drafted) of \(essays.count) started",
                           isDone: !essays.isEmpty && drafted == essays.count, target: .tab(.essays)))

        self.items = items
    }
}
