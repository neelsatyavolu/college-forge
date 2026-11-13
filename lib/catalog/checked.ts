import { SLATE_EMAIL_PIN, type College } from "./types";

/**
 * Schools whose portal URLs, sign-in hosts and sign-in steps were checked by hand against each school's
 * own pages on 2026-11-01, each with a logo in web/public/logos.
 */
export const CHECKED: College[] = [
  {
    id: "asu", name: "Arizona State University", monogram: "ASU", colors: { bg: "#8C1D40", fg: "#FFC627" }, state: "AZ",
    website: "asu.edu", domains: ["asu.edu"], hosts: ["my.asu.edu", "webapp4.asu.edu", "weblogin.asu.edu", "selfsub.asu.edu", "apply.apps.asu.edu"],
    aliases: ["asu", "arizona state", "asurite"], portalName: "My ASU", platform: "asurite-sso", loginUrl: "https://my.asu.edu/",
    howToLogIn: "Activate your ASURITE ID with the code in the \"ASU Account Activation\" email, then sign in to My ASU with it.",
    decisionNote: "Rolling: decisions usually come a few weeks after your application and documents are in.",
  },
  {
    id: "binghamton", name: "Binghamton University", monogram: "BU", colors: { bg: "#005A43", fg: "#FFFFFF" }, state: "NY",
    website: "binghamton.edu", domains: ["binghamton.edu"], hosts: ["connect.binghamton.edu", "idp.cc.binghamton.edu", "cas.cc.binghamton.edu", "password.binghamton.edu"],
    aliases: ["binghamton"], portalName: "Application Status Checker", platform: "slate",
    loginUrl: "https://connect.binghamton.edu/manage/login?realm=&r=/apply/status",
    howToLogIn: "Set a password at password.binghamton.edu/claim with the User ID from your confirmation email, then sign in with that User ID.",
    decisionNote: "Early action by Jan. 15, regular by Apr. 1.",

    decisions: { EA: "01-15", RD: "04-01" },
  },
  {
    id: "brandeis", name: "Brandeis University", monogram: "BR", colors: { bg: "#003478", fg: "#FFFFFF" }, state: "MA",
    website: "brandeis.edu", domains: ["brandeis.edu"], hosts: ["admissions.brandeis.edu"],
    aliases: ["brandeis"], portalName: "Applicant Status Portal", platform: "slate", loginUrl: "https://admissions.brandeis.edu/apply/status",
    howToLogIn: SLATE_EMAIL_PIN,
  },
  {
    id: "cwru", name: "Case Western Reserve University", monogram: "CW", colors: { bg: "#0A304E", fg: "#FFFFFF" }, state: "OH",
    website: "case.edu", domains: ["case.edu", "cwru.edu"], hosts: ["go.case.edu", "login.case.edu"],
    aliases: ["case", "cwru", "case western"], portalName: "Applicant Portal", platform: "slate", loginUrl: "https://go.case.edu/apply/status",
    howToLogIn: "Activate your CWRU Network ID from the invitation email, then sign in with it through CWRU single sign-on.",
    decisionNote: "Early Decision I by Dec. 5, Early Action around Dec. 19.",

    decisions: { ED: "12-05", EA: "12-19" },
  },
  {
    id: "emory", name: "Emory University", monogram: "EU", colors: { bg: "#012169", fg: "#F2A900" }, state: "GA",
    website: "emory.edu", domains: ["emory.edu"], hosts: ["admission.emory.edu", "apply.emory.edu"],
    aliases: ["emory"], portalName: "Check My Status", platform: "slate", loginUrl: "https://admission.emory.edu/apply/status",
    howToLogIn: SLATE_EMAIL_PIN, decisionNote: "ED I by Dec. 15, ED II by Feb. 15, regular by Apr. 1.",

    decisions: { ED: "12-15", ED2: "02-15", RD: "04-01" },
  },
  {
    id: "gwu", name: "George Washington University", monogram: "GW", colors: { bg: "#033C5A", fg: "#E5D19E" }, state: "DC",
    website: "gwu.edu", domains: ["gwu.edu"], hosts: ["ugadmissions.gwu.edu"],
    aliases: ["gw", "gwu", "george washington"], portalName: "Applicant Status Portal", platform: "slate",
    loginUrl: "https://ugadmissions.gwu.edu/apply/status", howToLogIn: SLATE_EMAIL_PIN,
  },
  {
    id: "iu", name: "Indiana University Bloomington", monogram: "IU", colors: { bg: "#990000", fg: "#EEEDEB" }, state: "IN",
    website: "iu.edu", domains: ["iu.edu", "indiana.edu"], hosts: ["process.indiana.edu", "apply.iu.edu"],
    aliases: ["iu", "indiana", "iub"], portalName: "IU Admissions Portal", platform: "slate", loginUrl: "https://process.indiana.edu/apply/status",
    howToLogIn: "Use the login details IU emails 2 to 3 business days after you apply to create a password. This is not One.IU.",
    decisionNote: "Complete by Nov. 1: answer by Jan. 15. Complete by Feb. 1: answer by Mar. 15.",

    decisions: { EA: "01-15", RD: "03-15" },
  },
  {
    id: "northeastern", name: "Northeastern University", monogram: "NU", colors: { bg: "#C8102E", fg: "#FFFFFF" }, state: "MA",
    website: "northeastern.edu", domains: ["northeastern.edu", "neu.edu"], hosts: ["apply.northeastern.edu"],
    aliases: ["northeastern", "neu"], portalName: "Application Status Portal", platform: "slate", loginUrl: "https://apply.northeastern.edu/apply/status",
    howToLogIn: SLATE_EMAIL_PIN, decisionNote: "ED I by Jan. 1, EA by Feb. 15, ED II by Mar. 1, regular by Apr. 1.",

    decisions: { ED: "01-01", EA: "02-15", ED2: "03-01", RD: "04-01" },
  },
  {
    id: "osu", name: "Ohio State University", monogram: "OSU", colors: { bg: "#BA0C2F", fg: "#FFFFFF" }, state: "OH",
    website: "osu.edu", domains: ["osu.edu", "ohio-state.edu"], hosts: ["appstatus.osu.edu", "buckeyelink.erp.osu.edu", "webauth.service.ohio-state.edu", "my.osu.edu"],
    aliases: ["osu", "ohio state", "buckeye"], portalName: "Applicant Center", platform: "netid-sso", loginUrl: "https://appstatus.osu.edu/",
    howToLogIn: "Activate your lastname.# username at my.osu.edu with the emailed code, set up BuckeyePass (Duo), then sign in.",
    decisionNote: "EA: Dec. 11 for Ohio residents, Jan. 22 for others. Regular: Mar. 5.",

    decisions: { EA: "01-22", RD: "03-05" },
  },
  {
    id: "psu", name: "Penn State", monogram: "PSU", colors: { bg: "#001E44", fg: "#FFFFFF" }, state: "PA",
    website: "psu.edu", domains: ["psu.edu"], hosts: ["mypennstate.psu.edu", "admissions.psu.edu", "accounts.psu.edu"],
    aliases: ["penn state", "psu", "pennstate"], portalName: "MyPennState", platform: "psu-sso", loginUrl: "https://mypennstate.psu.edu/",
    howToLogIn: "Sign in with your Penn State user ID (like abc123@psu.edu). Penn State emails setup steps after you apply.",
    microsoft: true,
  },
  {
    id: "purdue", name: "Purdue University", monogram: "PU", colors: { bg: "#000000", fg: "#CFB991" }, state: "IN",
    website: "purdue.edu", domains: ["purdue.edu"], hosts: ["apply.purdue.edu"],
    aliases: ["purdue"], portalName: "Application Status Portal", platform: "slate", loginUrl: "https://apply.purdue.edu/apply/status",
    howToLogIn: SLATE_EMAIL_PIN, decisionNote: "Early action Jan. 15, regular by Mar. 31.",

    decisions: { EA: "01-15", RD: "03-31" },
  },
  {
    id: "rutgers", name: "Rutgers University", monogram: "RU", colors: { bg: "#CC0033", fg: "#FFFFFF" }, state: "NJ",
    website: "rutgers.edu", domains: ["rutgers.edu"], hosts: ["rutgers.my.site.com", "rcm.rutgers.edu", "signin.rutgers.edu"],
    aliases: ["rutgers"], portalName: "Rutgers Application Portal", platform: "salesforce",
    loginUrl: "https://rutgers.my.site.com/ApplicantPortal/AppPortalCustom",
    howToLogIn: "After the \"next steps\" email, create a Rutgers CommunityID at rcm.rutgers.edu and sign in to the portal with it.",
    decisionNote: "Early action by Jan. 31, regular by Feb. 28.",

    decisions: { EA: "01-31", RD: "02-28" },
  },
  {
    id: "stonybrook", name: "Stony Brook University", monogram: "SBU", colors: { bg: "#990000", fg: "#FFFFFF" }, state: "NY",
    website: "stonybrook.edu", domains: ["stonybrook.edu", "sunysb.edu"], hosts: ["enroll.stonybrook.edu"],
    aliases: ["stony brook", "stonybrook", "sbu"], portalName: "StartSBU Portal", platform: "slate", loginUrl: "https://enroll.stonybrook.edu/apply/status",
    howToLogIn: "Sign in with the email and password Stony Brook emails you after you apply.",
    decisionNote: "Early action by late January, regular by late March.",

    decisions: { EA: "01-31", RD: "03-31" },
  },
  {
    id: "unc", name: "UNC Chapel Hill", monogram: "UNC", colors: { bg: "#7BAFD4", fg: "#13294B" }, state: "NC",
    website: "unc.edu", domains: ["unc.edu"], hosts: ["mycarolina.unc.edu"],
    aliases: ["unc", "chapel hill", "north carolina", "mycarolina"], portalName: "MyCarolina", platform: "slate", loginUrl: "https://mycarolina.unc.edu/apply/status",
    howToLogIn: SLATE_EMAIL_PIN, decisionNote: "EA: by Dec. 20 for NC residents, Feb. 15 for others. Regular: Mar. 31.",

    decisions: { EA: "02-15", RD: "03-31" },
  },
  {
    id: "buffalo", name: "University at Buffalo", monogram: "UB", colors: { bg: "#005BBB", fg: "#FFFFFF" }, state: "NY",
    website: "buffalo.edu", domains: ["buffalo.edu"], hosts: ["ubconnect.buffalo.edu"],
    aliases: ["buffalo", "ub", "ubconnect"], portalName: "UB Connect", platform: "slate", loginUrl: "https://ubconnect.buffalo.edu/apply/status",
    howToLogIn: "Use the link in UB's acknowledgement email to set a password, then sign in with your email.",
  },
  {
    id: "uga", name: "University of Georgia", monogram: "UGA", colors: { bg: "#BA0C2F", fg: "#FFFFFF" }, state: "GA",
    website: "uga.edu", domains: ["uga.edu"], hosts: ["apply.uga.edu"],
    aliases: ["uga", "university of georgia"], portalName: "myStatus", platform: "slate", loginUrl: "https://apply.uga.edu/apply/status",
    howToLogIn: SLATE_EMAIL_PIN, decisionNote: "EA: late Nov. in state, early to mid Dec. out of state. Regular: early to mid March.",

    decisions: { EA: "12-15", RD: "03-15" },
  },
  {
    id: "uiuc", name: "University of Illinois Urbana-Champaign", monogram: "UI", colors: { bg: "#13294B", fg: "#FF5F05" }, state: "IL",
    website: "illinois.edu", domains: ["illinois.edu", "uiuc.edu"], hosts: ["myillini.illinois.edu"],
    aliases: ["illinois", "uiuc", "illini", "myillini"], portalName: "myIllini", platform: "custom",
    loginUrl: "https://myillini.illinois.edu/IdentityManagement/Login",
    howToLogIn: "Sign in with the myIllini username and password you made when you applied.",
    decisionNote: "Early action Jan. 29, regular Feb. 26.",

    decisions: { EA: "01-29", RD: "02-26" },
  },
  {
    id: "umd", name: "University of Maryland", monogram: "UMD", colors: { bg: "#E21833", fg: "#FFD200" }, state: "MD",
    website: "umd.edu", domains: ["umd.edu"], hosts: ["terpengage.umd.edu"],
    aliases: ["umd", "maryland", "terps", "tap"], portalName: "Terps Application Portal", platform: "salesforce", loginUrl: "https://terpengage.umd.edu/tap/s/",
    howToLogIn: "Create your TAP account from the email UMD sends within two business days of applying. Your username is your email with .tap on the end (you@example.com.tap); saving just your email works here too.",
    decisionNote: "Early action by Feb. 1, regular by Apr. 1.",

    decisions: { EA: "02-01", RD: "04-01" },
  },
  {
    id: "umich", name: "University of Michigan", monogram: "UM", colors: { bg: "#00274C", fg: "#FFCB05" }, state: "MI",
    website: "umich.edu", domains: ["umich.edu"], hosts: ["enrollmentconnect.umich.edu"],
    aliases: ["umich", "michigan", "u of m"], portalName: "Enrollment Connect", platform: "slate", loginUrl: "https://enrollmentconnect.umich.edu/apply/status",
    howToLogIn: SLATE_EMAIL_PIN, decisionNote: "ED by Dec. 24, EA by Jan. 29, regular by Apr. 2.",

    decisions: { ED: "12-24", EA: "01-29", RD: "04-02" },
  },
  {
    id: "pitt", name: "University of Pittsburgh", monogram: "PITT", colors: { bg: "#003594", fg: "#FFB81C" }, state: "PA",
    website: "pitt.edu", domains: ["pitt.edu"], hosts: ["admissions.pitt.edu", "explore.pitt.edu", "passport.pitt.edu", "activateaccount.pitt.edu", "my.pitt.edu"],
    aliases: ["pitt", "pittsburgh"], portalName: "Pitt Applicant Portal", platform: "slate", loginUrl: "https://admissions.pitt.edu/apply/status",
    howToLogIn: "Activate your Pitt account from the emailed link, then sign in through Pitt Passport with your Pitt username.",
    decisionNote: "Rolling: about 8 to 10 weeks after every required item is in.",
  },
  {
    id: "usc", name: "University of Southern California", monogram: "USC", colors: { bg: "#990000", fg: "#FFC72C" }, state: "CA",
    website: "usc.edu", domains: ["usc.edu"], hosts: ["applyto.usc.edu"],
    aliases: ["usc", "southern california"], portalName: "Applicant Portal", platform: "slate", loginUrl: "https://applyto.usc.edu/apply/status",
    howToLogIn: SLATE_EMAIL_PIN, decisionNote: "ED mid-December, EA mid-January, regular Apr. 1.",

    decisions: { ED: "12-15", EA: "01-15", RD: "04-01" },
  },
  {
    id: "uva", name: "University of Virginia", monogram: "UVA", colors: { bg: "#232D4B", fg: "#E57200" }, state: "VA",
    website: "virginia.edu", domains: ["virginia.edu"], hosts: ["apply.undergradadmission.virginia.edu"],
    aliases: ["uva", "virginia"], portalName: "Applicant Status Portal", platform: "slate",
    loginUrl: "https://apply.undergradadmission.virginia.edu/apply/status",
    howToLogIn: SLATE_EMAIL_PIN, decisionNote: "ED by Dec. 15, EA by Feb. 15, regular by Apr. 1.",

    decisions: { ED: "12-15", EA: "02-15", RD: "04-01" },
  },
  {
    id: "uw", name: "University of Washington", monogram: "UW", colors: { bg: "#4B2E83", fg: "#B7A57A" }, state: "WA",
    website: "washington.edu", domains: ["washington.edu", "uw.edu"], hosts: ["seattle.admissions.uw.edu", "identity.uw.edu", "my.uw.edu", "idp.u.washington.edu"],
    aliases: ["uw", "uw seattle", "university of washington", "udub"], portalName: "UW Application Portal", platform: "slate",
    loginUrl: "https://seattle.admissions.uw.edu/portal/application_status_portal",
    howToLogIn: "Set up your portal login from the confirmation email, then sign in with email and password.",
    decisionNote: "No early round. First-year decisions Mar. 1 to 15.",

    decisions: { RD: "03-15" },
  },
  {
    id: "wisc", name: "University of Wisconsin–Madison", monogram: "WIS", colors: { bg: "#C5050C", fg: "#FFFFFF" }, state: "WI",
    website: "wisc.edu", domains: ["wisc.edu"], hosts: ["go.wisc.edu", "madison.sis.wisc.edu", "login.wisc.edu", "mynetid.wisc.edu", "my.wisc.edu"],
    aliases: ["wisc", "wisconsin", "uw madison"], portalName: "Student Center", platform: "netid-sso", loginUrl: "https://go.wisc.edu/applicant",
    howToLogIn: "Activate a NetID at mynetid.wisc.edu with the Campus ID from your acknowledgement email, then sign in to Student Center.",
    decisionNote: "Early action by Jan. 31, regular by Mar. 31.",

    decisions: { EA: "01-31", RD: "03-31" },
  },
];
