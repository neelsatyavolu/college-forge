import SwiftUI

struct OnboardingWelcomeStep: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                ForgeMark(size: 52)
                VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                    Eyebrow(text: "Get started")
                    Text("Set up your applications hub")
                        .font(.forgeDisplay(.largeTitle))
                        .foregroundStyle(Theme.ink)
                    Text("Share your academics and interests to get a balanced, data-backed starting list. Then keep your applications, deadlines and essays in one place.")
                        .foregroundStyle(Theme.body)
                }
                VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                    WelcomeLine(systemImage: "person.text.rectangle", text: "Basics and academics")
                    WelcomeLine(systemImage: "text.bubble", text: "Activities and awards. Pile on detail.")
                    WelcomeLine(systemImage: "slider.horizontal.3", text: "List strategy: ambitious, just right, or conservative")
                    WelcomeLine(systemImage: "building.columns", text: "A college list with fit notes and clear uncertainties")
                }
            }
            .padding(Theme.Spacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct WelcomeLine: View {
    let systemImage: String
    let text: String

    var body: some View {
        Label {
            Text(text).foregroundStyle(Theme.ink)
        } icon: {
            Image(systemName: systemImage).foregroundStyle(Theme.accent)
        }
    }
}

struct OnboardingIdentityStep: View {
    @Binding var answers: OnboardingAnswers

    var body: some View {
        Form {
            Section {
                ProfileLabeledField(label: "Full name", text: $answers.name, prompt: "Alex Rivera")
                ProfileLabeledField(label: "Grad year", text: $answers.gradYear, prompt: "2027", keyboard: .numberPad)
                ProfileLabeledField(label: "High school", text: $answers.hs, prompt: "Lincoln High")
                ProfileLabeledField(label: "Intended major", text: $answers.intended, prompt: "Biology")
            } header: {
                Text("Required")
            } footer: {
                Text("This powers your overview and profile.")
            }
            Section("Optional") {
                ProfileLabeledField(label: "Location", text: $answers.location, prompt: "Austin, TX")
            }
        }
    }
}

struct OnboardingAcademicsStep: View {
    @Binding var answers: OnboardingAnswers

    var body: some View {
        Form {
            Section {
                ProfileLabeledField(label: "Weighted", text: $answers.gpaWeighted, prompt: "4.28", keyboard: .decimalPad)
                ProfileLabeledField(label: "Unweighted", text: $answers.gpaUnweighted, prompt: "3.95", keyboard: .decimalPad)
            } header: {
                Text("GPA")
            } footer: {
                Text("At least one is required. Weighted is on a 0–6 scale, unweighted 0–4.")
            }
            Section {
                Toggle("Test optional", isOn: $answers.testOptional.animation())
                if !answers.testOptional {
                    ProfileLabeledField(label: "SAT superscore", text: $answers.sat, prompt: "1540", keyboard: .numberPad)
                    ProfileLabeledField(label: "Note", text: $answers.satNote, prompt: "790 M / 750 EBRW")
                }
            } header: {
                Text("Testing")
            } footer: {
                Text(answers.testOptional ? "You're not reporting SAT or ACT." : "Optional. Turn on Test optional if you're not reporting scores.")
            }
        }
    }
}

struct OnboardingStoryStep: View {
    @Binding var story: StoryNotes

    var body: some View {
        Form {
            Section {
                Text("Dump as much as you want: clubs, sports, jobs, research, volunteering, family responsibilities, summer programs. More detail means a stronger profile and a smarter list. Don't self-edit yet.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.body)
            }
            StoryBox(title: "Activities and extracurriculars",
                     hint: "One per line. Role, hours a week, years, impact if you know them.",
                     placeholder: "Debate captain, 8 hrs/wk, 3 yrs, state semis",
                     text: $story.activities, emptyNote: "Empty. Add a few if you can.")
            StoryBox(title: "Awards and honors",
                     hint: "School, state, national: academic, arts, sports, community.",
                     placeholder: "AP Scholar with Distinction",
                     text: $story.awards, emptyNote: "Optional but helpful")
            StoryBox(title: "Anything else",
                     hint: "Course load, family context, cost limits, goals.",
                     placeholder: "First-gen, need strong financial aid, love small seminars",
                     text: $story.other, emptyNote: nil)
        }
    }
}

private struct StoryBox: View {
    let title: String
    let hint: String
    let placeholder: String
    @Binding var text: String
    let emptyNote: String?

    var body: some View {
        Section {
            TextField(placeholder, text: $text, axis: .vertical)
                .lineLimit(4...12)
        } header: {
            Text(title)
        } footer: {
            let lines = OnboardingAnswers.lineCount(text)
            Text(lines > 0 ? "\(hint) \(lines) line\(lines == 1 ? "" : "s")." : [hint, emptyNote].compactMap { $0 }.joined(separator: " "))
        }
    }
}
