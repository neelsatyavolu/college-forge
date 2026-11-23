import Foundation
import Testing
@testable import Forge

@Suite("Onboarding answers")
struct OnboardingAnswersTests {
    private func filled() -> OnboardingAnswers {
        var a = OnboardingAnswers()
        a.name = "Alex Example"
        a.gradYear = "2027"
        a.hs = "Synthetic High"
        a.intended = "History"
        a.gpaUnweighted = "3.7"
        return a
    }

    @Test func identityRequiresBasics() {
        var a = filled()
        #expect(a.identityError == nil)
        a.gradYear = ""
        #expect(a.identityError != nil)
        a.cycle = "Fall 2027"
        #expect(a.identityError == nil)
    }

    @Test func academicsRules() {
        var a = filled()
        #expect(a.academicError == nil)
        a.gpaUnweighted = ""
        #expect(a.academicError == "Enter at least one GPA (weighted or unweighted).")
        a.gpaWeighted = "7"
        #expect(a.academicError == "Weighted GPA must be a number from 0 to 6.")
        a.gpaWeighted = "4.4"
        a.sat = "1700"
        #expect(a.academicError != nil)
        a.testOptional = true
        #expect(a.academicError == nil)
    }

    @Test func regionsAnyIsExclusive() {
        var a = OnboardingAnswers()
        a.toggleRegion("west")
        a.toggleRegion("south")
        #expect(a.prefs.regions == ["west", "south"])
        a.toggleRegion("any")
        #expect(a.prefs.regions == ["any"])
        a.toggleRegion("midwest")
        #expect(a.prefs.regions == ["midwest"])
        a.toggleRegion("midwest")
        #expect(a.prefs.regions.isEmpty)
        a.toggleSetting("urban")
        a.toggleSetting("urban")
        #expect(a.prefs.settings.isEmpty)
    }

    @Test func completionBodyMatchesWeb() throws {
        var a = filled()
        a.testOptional = true
        a.sat = "1400"
        a.prefs.appCount = nil
        let body = a.completionFields
        #expect(body["applicant"]?["cycle"] == .string("Fall 2027"))
        #expect(body["applicant"]?["year"] == .string("Class of 2027"))
        #expect(body["applicant"]?["gpaWeighted"] == .string("—"))
        #expect(body["applicant"]?["sat"] == .string("—"))
        #expect(body["testing"]?["satNote"] == .string("Test optional"))
        #expect(body["listPrefs"]?["appCount"] == .null)
        let json = try JSONEncoder().encode(body)
        #expect(String(decoding: json, as: UTF8.self).contains("\"appCount\":null"))
    }

    @Test func prefillFromWorkspace() {
        var ws = Workspace.empty
        ws.applicant.name = "Sam"
        ws.applicant.gpaWeighted = "—"
        ws.profile.testing.sat = "1350"
        ws.onboarding.listPrefs = ListPrefs(ambition: "ambitious", appCount: 3)
        let a = OnboardingAnswers(workspace: ws)
        #expect(a.name == "Sam")
        #expect(a.gpaWeighted == "")
        #expect(a.sat == "1350")
        #expect(a.prefs.ambition == "ambitious")
        #expect(a.prefs.appCount == nil)
    }

    @Test func multipartBody() {
        let body = OnboardingMultipart.body([OnboardingFile(name: "re\"sume.txt", mimeType: "text/plain", data: Data("hi".utf8))], boundary: "B")
        let text = String(decoding: body, as: UTF8.self)
        #expect(text.contains("--B\r\nContent-Disposition: form-data; name=\"files\"; filename=\"re'sume.txt\"\r\n"))
        #expect(text.contains("Content-Type: text/plain\r\n\r\nhi\r\n"))
        #expect(text.hasSuffix("--B--\r\n"))
    }

    @MainActor @Test func gateWaitsForLoad() {
        let services = AppServices(config: AppConfig(baseURL: URL(string: "https://forge.example")!))
        #expect(OnboardingGate.shouldPresent(services.store) == false)
        services.store.seed(workspace: .empty, tracker: .empty)
        #expect(OnboardingGate.shouldPresent(services.store) == true)
        var done = Workspace.empty
        done.revision = 1
        done.onboarding.completed = true
        services.store.seed(workspace: done, tracker: .empty)
        #expect(OnboardingGate.shouldPresent(services.store) == false)
    }
}
