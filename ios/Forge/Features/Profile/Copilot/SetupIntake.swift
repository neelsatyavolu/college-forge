import Foundation

/// The quick-start form at the beginning of the interview. Every field is optional; saving writes the
/// profile and tells the AI what was filled and what wasn't. Mirrors public/hub/IntakeTile.jsx.
struct SetupIntakeForm: Hashable, Sendable {
    var name = ""
    var gradYear = ""
    var hs = ""
    /// A state code, "INTL" for outside the US, or "".
    var residency = ""
    var citizenship: String?
    var gpaUnweighted = ""
    var gpaWeighted = ""
    var gpaRecent = ""
    var gpaTrend: String?
    /// Unweighted GPA for 9th, 10th and 11th grade, saved as `applicant.gpaByYear`.
    var gpa9 = ""
    var gpa10 = ""
    var gpa11 = ""
    var sat = ""
    var act = ""
    var testOptional = false
    var intended = ""
    var incomeBracket: String?
    var budget: String?
    var needAid: String?
    var firstGen: String?
    var ambition: String?
    var suppCount = ""
    var noSuppCount = ""
    var recommendCounts = false
    var ed: String?
    var settings: [String] = []
    var size: String?
    var regions: [String] = []
    var campusNotes = ""
    var likedSchools = ""
    var activities = ""

    init() {}

    /// Prefilled from what the workspace already knows.
    init(workspace ws: Workspace) {
        let stat = { (s: String) in s.isPresentStat ? s : "" }
        name = ws.applicant.name
        gradYear = ws.profile.gradYear
        hs = ws.profile.hs
        residency = ws.profile.residency
        gpaUnweighted = stat(ws.applicant.gpaUnweighted)
        gpaWeighted = stat(ws.applicant.gpaWeighted)
        sat = stat(ws.profile.testing.sat).isEmpty ? stat(ws.applicant.sat) : stat(ws.profile.testing.sat)
        let note = ws.profile.testing.satNote.isEmpty ? ws.applicant.satNote : ws.profile.testing.satNote
        testOptional = note.range(of: "optional|not submit", options: [.regularExpression, .caseInsensitive]) != nil
        intended = ws.profile.intended
        if let lp = ws.onboarding.listPrefs {
            settings = lp.settings
            regions = lp.regions
            if lp.size != "any" { size = lp.size } else if !lp.settings.isEmpty { size = "any" }
        }
        activities = ws.profile.activities.map { [$0.name, $0.role ?? ""].filter { !$0.isEmpty }.joined(separator: ", ") }.joined(separator: "\n")
    }

    static let states = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI"
        .split(separator: " ").map(String.init)

    typealias Choice = (value: String, label: String)

    static let choices: [String: [Choice]] = [
        "citizenship": [("us", "US citizen"), ("permanent", "Permanent resident"), ("international", "International"), ("unsure", "Not sure")],
        "gpaTrend": [("up", "Going up"), ("steady", "Steady"), ("down", "Going down"), ("", "Not sure")],
        "incomeBracket": [("lt30", "Under $30k"), ("30-48", "$30–48k"), ("48-75", "$48–75k"), ("75-110", "$75–110k"), ("gt110", "Over $110k"), ("unsure", "Not sure")],
        "budget": [("lt15", "Under $15k"), ("15-30", "$15–30k"), ("30-50", "$30–50k"), ("50plus", "$50k+"), ("unsure", "Not sure")],
        "needAid": [("yes", "Yes"), ("no", "No"), ("", "Not sure")],
        "firstGen": [("yes", "Yes"), ("no", "No"), ("unsure", "Not sure")],
        "ambition": [("ambitious", "More reaches"), ("balanced", "Balanced"), ("conservative", "More likely schools"), ("", "Not sure")],
        "ed": [("yes", "Yes"), ("maybe", "Maybe"), ("no", "No")],
        "settings": [("urban", "City"), ("suburban", "Suburban"), ("college-town", "College town"), ("rural", "Rural"), ("any", "Any")],
        "size": [("small", "Small (<5k)"), ("medium", "Medium (5–15k)"), ("large", "Large (15k+)"), ("any", "Any")],
        "regions": [("west", "West"), ("midwest", "Midwest"), ("south", "South"), ("mid-atlantic", "Mid-Atlantic"), ("northeast", "New England"), ("any", "Anywhere")],
    ]

    /// Suggested counts (with supplements, without) by mix, for students who don't know how many to apply to.
    static func recommendedCounts(_ ambition: String?) -> (supp: Int, quick: Int) {
        switch ambition {
        case "ambitious": (9, 3)
        case "conservative": (6, 4)
        default: (8, 3)
        }
    }

    static func label(_ key: String, _ value: String) -> String {
        choices[key]?.first { $0.value == value }?.label ?? value
    }

    /// Pick-several chips: "any" clears the others.
    static func toggled(_ list: [String], _ value: String) -> [String] {
        if value == "any" { return list.contains("any") ? [] : ["any"] }
        return list.contains(value) ? list.filter { $0 != value } : list.filter { $0 != "any" } + [value]
    }

    struct Built: Sendable {
        var patch: [String: JSONValue]
        var said: [String]
        var blanks: [String]

        /// What the AI is told after saving.
        var message: String {
            (["I filled in the quick start:"] + said.map { "- \($0)" } + (blanks.isEmpty ? [] : ["Not sure / left blank: \(blanks.joined(separator: ", "))."]))
                .joined(separator: "\n")
        }
    }

    /// The patch the form saves and a readable summary of what was given and what was left blank (`ikBuild`).
    func build() -> Built {
        let trim = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines) }
        func num(_ v: String, _ max: Double) -> String {
            let t = trim(v)
            guard t.range(of: #"^\d+(\.\d+)?$"#, options: .regularExpression) != nil, let n = Double(t), n <= max else { return "" }
            return t
        }
        var applicant: [String: JSONValue] = [:]
        if !trim(name).isEmpty { applicant["name"] = .string(trim(name)) }
        if !num(gpaUnweighted, 4).isEmpty { applicant["gpaUnweighted"] = .string(num(gpaUnweighted, 4)) }
        if !num(gpaWeighted, 6).isEmpty { applicant["gpaWeighted"] = .string(num(gpaWeighted, 6)) }
        if !num(gpaRecent, 4).isEmpty { applicant["gpaRecent"] = .string(num(gpaRecent, 4)) }
        if let gpaTrend, !gpaTrend.isEmpty { applicant["gpaTrend"] = .string(gpaTrend) }
        let years = [("9", gpa9), ("10", gpa10), ("11", gpa11)].filter { !num($0.1, 4).isEmpty }
        if !years.isEmpty {
            applicant["gpaByYear"] = .object(Dictionary(uniqueKeysWithValues: years.map { ($0.0, JSONValue.string(num($0.1, 4))) }))
        }

        var testing: [String: JSONValue] = [:]
        if testOptional {
            testing["satNote"] = .string("Test optional")
        } else {
            if !num(sat, 1600).isEmpty, (Double(sat) ?? 0) >= 400 { testing["sat"] = .string(num(sat, 1600)) }
            if !num(act, 36).isEmpty { testing["act"] = .string(num(act, 36)) }
        }
        var profile: [String: JSONValue] = [:]
        if !trim(hs).isEmpty { profile["hs"] = .string(trim(hs)) }
        if trim(gradYear).range(of: #"^\d{4}$"#, options: .regularExpression) != nil, let y = Double(trim(gradYear)) { profile["gradYear"] = .number(y) }
        if !residency.isEmpty, residency != "INTL" { profile["residency"] = .string(residency) }
        if !trim(intended).isEmpty { profile["intended"] = .string(trim(intended)) }
        if !testing.isEmpty { profile["testing"] = .object(testing) }

        let rec = Self.recommendedCounts(ambition)
        let isCount = { (s: String) in trim(s).range(of: #"^\d{1,2}$"#, options: .regularExpression) != nil }
        let supp: Int? = recommendCounts ? rec.supp : isCount(suppCount) ? Int(trim(suppCount)) : nil
        let quick: Int? = recommendCounts ? rec.quick : isCount(noSuppCount) ? Int(trim(noSuppCount)) : nil

        var lp: [String: JSONValue] = [:]
        if let citizenship {
            lp["citizenship"] = .string(residency == "INTL" && citizenship == "unsure" ? "international" : citizenship)
        } else if residency == "INTL" {
            lp["citizenship"] = .string("international")
        }
        if let incomeBracket { lp["incomeBracket"] = .string(incomeBracket) }
        if let budget { lp["budget"] = .string(budget) }
        if needAid == "yes" || needAid == "no" { lp["needAid"] = .bool(needAid == "yes") }
        if let firstGen { lp["firstGen"] = .string(firstGen) }
        if let ambition, !ambition.isEmpty { lp["ambition"] = .string(ambition) }
        if let supp { lp["suppCount"] = .number(Double(supp)) }
        if let quick { lp["noSuppCount"] = .number(Double(quick)) }
        if recommendCounts { lp["countsRecommended"] = .bool(true) }
        if let ed { lp["ed"] = .string(ed) }
        if !settings.isEmpty { lp["settings"] = .array(settings.map(JSONValue.string)) }
        if let size { lp["size"] = .string(size) }
        if !regions.isEmpty { lp["regions"] = .array(regions.map(JSONValue.string)) }
        if !trim(campusNotes).isEmpty { lp["notes"] = .string(String(trim(campusNotes).prefix(1000))) }

        let label = Self.label
        let s = { (v: JSONValue?) -> String? in if case .string(let x)? = v { return x } else { return nil } }
        var said: [String?] = [
            s(applicant["name"]).map { "Name: \($0)" },
            s(profile["hs"]).map { "High school: \($0)" },
            profile["gradYear"] != nil ? "Class of \(trim(gradYear))" : nil,
            residency.isEmpty ? nil : "State: \(residency == "INTL" ? "outside the US" : residency)",
            s(lp["citizenship"]).map { "Citizenship: \(label("citizenship", $0))" },
            s(applicant["gpaUnweighted"]).map { "Unweighted GPA \($0)" },
            s(applicant["gpaWeighted"]).map { "weighted \($0)" },
            s(applicant["gpaRecent"]).map { "10th–11th GPA \($0)" },
            s(applicant["gpaTrend"]).map { "Grades \(label("gpaTrend", $0).lowercased())" },
        ]
        let tests = testOptional ? "Applying test-optional"
            : [s(testing["sat"]).map { "SAT \($0)" }, s(testing["act"]).map { "ACT \($0)" }].compactMap { $0 }.joined(separator: ", ")
        said.append(tests.isEmpty ? nil : tests)
        said += [
            s(profile["intended"]).map { "Interested in: \($0)" },
            incomeBracket.map { "Family income: \(label("incomeBracket", $0))" },
            budget.map { "Budget: \(label("budget", $0)) a year" },
            lp["needAid"] != nil ? "Need-based aid: \(needAid == "yes" ? "yes" : "no")" : nil,
            firstGen.map { "First-gen: \(label("firstGen", $0))" },
            s(lp["ambition"]).map { "Mix: \(label("ambition", $0))" },
            supp.map { "\($0) schools with supplements\(quick.map { " and \($0) without" } ?? "")\(recommendCounts ? " (Forge's suggestion; I wasn't sure)" : "")" },
            ed.map { "Early Decision: \($0)" },
            settings.isEmpty ? nil : "Campus setting: \(settings.map { label("settings", $0) }.joined(separator: ", "))",
            size.map { "Size: \(label("size", $0))" },
            regions.isEmpty ? nil : "Regions: \(regions.map { label("regions", $0) }.joined(separator: ", "))",
            s(lp["notes"]).map { "Also matters: \($0)" },
            trim(likedSchools).isEmpty ? nil : "Schools I already like: \(trim(likedSchools))",
        ]
        if !trim(activities).isEmpty {
            let lines = trim(activities).split(separator: "\n").map { "  · \($0.trimmingCharacters(in: .whitespaces))" }.filter { $0.count > 4 }
            said.append("Activities and awards (one per line; please save each):\n\(lines.joined(separator: "\n"))")
        }
        let blanks: [String?] = [
            applicant["gpaUnweighted"] == nil && applicant["gpaWeighted"] == nil ? "GPA" : nil,
            !testOptional && testing["sat"] == nil && testing["act"] == nil ? "test scores" : nil,
            profile["intended"] == nil ? "intended major" : nil,
            incomeBracket == nil ? "family income" : nil,
            budget == nil ? "budget" : nil,
            lp["needAid"] == nil ? "need-based aid" : nil,
            lp["ambition"] == nil ? "list mix" : nil,
            supp == nil ? "how many schools" : nil,
            ed == nil ? "Early Decision" : nil,
            settings.isEmpty && regions.isEmpty ? "campus preferences" : nil,
            trim(activities).isEmpty ? "activities" : nil,
        ]
        var patch: [String: JSONValue] = [:]
        if !applicant.isEmpty { patch["applicant"] = .object(applicant) }
        if !profile.isEmpty { patch["profile"] = .object(profile) }
        if !lp.isEmpty { patch["listPrefs"] = .object(lp) }
        return Built(patch: patch, said: said.compactMap { $0 }, blanks: blanks.compactMap { $0 })
    }

    /// The prompt a student copies into an assistant that knows them.
    static let agentPrompt = """
    I'm setting up my college applications in Forge. Using everything you know about me from our past conversations, files and memory, write a profile summary I can paste in. Use these headings and keep it under 900 words. Write "unknown" for anything you don't know; don't guess.

    Basics: name, high school, city and state, graduation year, citizenship.
    Academics: unweighted and weighted GPA, grades by year if you know them (to show a trend), class rank, hardest courses (AP/IB/honors/dual enrollment) and grades in them, SAT/ACT scores and sections, AP exam scores.
    Intended major(s) and why; careers I've talked about.
    Activities: each one with my role, grades involved, hours per week, and what I actually did or achieved.
    Awards and honors: name, level (school/regional/state/national), year.
    Family and money: whether I'd be the first in my family to attend college, rough family income range, what my family can pay per year, whether we'd apply for need-based aid.
    College preferences: size, setting, regions, weather, distance from home, anything I said I wanted or wanted to avoid, colleges I've mentioned.
    Personality and story: what drives me, challenges I've faced, things I'm proud of, how I spend free time, how people describe me.
    Plans: how many colleges I want to apply to, Early Decision thoughts, deadlines I've mentioned.
    """

    static func pastedSummaryMessage(_ text: String) -> String {
        "Here's a profile summary my AI wrote about me. Please save everything you can from it, then ask me only about what's missing:\n\n\(text.trimmingCharacters(in: .whitespacesAndNewlines))"
    }
}
