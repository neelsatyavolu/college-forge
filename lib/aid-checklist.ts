/**
 * "What you'll need" for the FAFSA and the CSS Profile, step by step, for a student entering college in fall 2027
 * (the 2027-28 FAFSA, which uses 2025 tax information). Built from the student's aid details and which schools on
 * their list ask for the CSS Profile or IDOC (lib/aid-plan.ts). Links go to official sites only.
 *
 * Forge never asks for or stores an SSN, an FSA ID or its password, or a tax document. These steps tell the student
 * what to have ready; they enter it on StudentAid.gov and the College Board's site themselves.
 */
import type { Workspace } from "./store";
import type { AidPlan } from "./aid-plan";

export type AidStep = { id: string; title: string; why: string; items: string[]; links: { label: string; url: string }[]; done?: boolean };

export const AID_LINKS = {
  fsaId: "https://studentaid.gov/fsa-id/create-account/launch",
  fafsa: "https://studentaid.gov/h/apply-for-aid/fafsa",
  fafsaFilling: "https://studentaid.gov/articles/things-you-need-for-fafsa/",
  schoolCodes: "https://fsapartners.ed.gov/knowledge-center/library/resource-type/Federal%20School%20Code%20Lists",
  contributors: "https://studentaid.gov/articles/fafsa-student-steps/",
  css: "https://cssprofile.collegeboard.org/",
  cssWaivers: "https://cssprofile.collegeboard.org/fee-waivers",
  idoc: "https://idoc.collegeboard.org/",
} as const;

const DONE = new Set(["submitted", "processed"]);

export function aidChecklist(ws: Workspace, plan: AidPlan): AidStep[] {
  const aid = ws.aidProfile ?? {};
  const split = aid.parentStatus === "divorced_separated";
  const listed = ws.colleges.map((c) => c.short || c.name);
  const active = plan.schools.filter((s) => !s.ignoreAid);
  const cssSchools = active.filter((s) => s.css === "required").map((s) => s.name);
  const idocSchools = active.filter((s) => s.idoc).map((s) => s.name);
  const fa = ws.financialAid;

  const steps: AidStep[] = [
    {
      id: "accounts",
      title: "Make StudentAid.gov accounts",
      why: "Each person who adds information to your FAFSA signs it with their own account.",
      items: [
        "You make one, and so does each contributor: your parent(s), and a parent's spouse if they file taxes together.",
        ...(split ? ["Divorced or separated parents: the parent who gave more financial support in the last 12 months fills in the FAFSA (with their spouse, if remarried)."] : []),
        "Each person needs their own email and phone number. Verification can take a few days, so do this first.",
        "Keep your FSA ID and password to yourself. Forge will never ask for them.",
      ],
      links: [{ label: "Create an account", url: AID_LINKS.fsaId }, { label: "Steps for students and contributors", url: AID_LINKS.contributors }],
    },
    {
      id: "documents",
      title: "Gather 2025 tax information",
      why: "The 2027-28 FAFSA uses 2025 income (\"prior-prior year\"), so you can file now.",
      items: [
        "Parents' 2025 federal tax return and W-2s, and yours if you filed. Each contributor's consent lets the IRS fill most of it in.",
        "Records of untaxed income and child support received in 2025.",
        "If your parents didn't file a 2025 return, have their 2025 W-2s or income records instead.",
      ],
      links: [{ label: "What the FAFSA asks", url: AID_LINKS.fafsaFilling }],
    },
    {
      id: "assets",
      title: "Note account balances on the day you file",
      why: "Assets are reported as of the day you submit, not as of 2025.",
      items: [
        "Cash, savings and checking; investments (not retirement accounts and not the home you live in).",
        "The FAFSA leaves out a family business with 100 or fewer employees and a family farm you live on.",
        "Families with income under about $60,000 often skip the asset questions; the form tells you.",
      ],
      links: [],
    },
    {
      id: "schools",
      title: "List your schools on the FAFSA",
      why: "Each school you list gets your FAFSA results. You can list up to 20.",
      items: [
        listed.length ? `From your list: ${listed.join(", ")}.` : "Add schools to your shortlist first.",
        "Search each one by name inside the FAFSA; the official Federal School Code list is there if a name is ambiguous.",
      ],
      links: [{ label: "Find school codes", url: AID_LINKS.schoolCodes }],
    },
    {
      id: "fafsa",
      title: "Submit the FAFSA",
      why: "The 2027-28 FAFSA is open now. Some schools and states give aid first come, first served, so earlier is better.",
      items: ["Check each school's aid deadline on its row below.", "Read your FAFSA Submission Summary when it arrives and fix anything that looks wrong."],
      links: [{ label: "Open the FAFSA", url: AID_LINKS.fafsa }],
      done: DONE.has(fa.fafsaStatus),
    },
  ];
  if (cssSchools.length) {
    steps.push({
      id: "css",
      title: "Submit the CSS Profile",
      why: "Many private colleges use the College Board's CSS Profile to give their own grants. It asks more than the FAFSA.",
      items: [
        `Needed for: ${cssSchools.join(", ")}.`,
        "It asks about home equity, a family business and siblings in college, which the FAFSA doesn't.",
        "Fee: about $25 for the first school and $16 for each one after. Families with income up to $100,000 get a fee waiver automatically.",
        ...(split ? ["Divorced or separated parents: many of these schools also want a Noncustodial Parent Profile from the other parent. Check each school's aid page; some grant waivers."] : []),
      ],
      links: [{ label: "Open the CSS Profile", url: AID_LINKS.css }, { label: "Fee waivers", url: AID_LINKS.cssWaivers }],
      done: DONE.has(fa.cssStatus),
    });
  }
  if (idocSchools.length) {
    steps.push({
      id: "idoc",
      title: "Upload tax documents to IDOC",
      why: "IDOC is the College Board's secure upload where some CSS Profile schools collect tax returns. You'll get an email after the CSS Profile if a school needs it.",
      items: [`Used by: ${idocSchools.join(", ")}.`, "Upload only on IDOC itself, never to Forge or by email."],
      links: [{ label: "Open IDOC", url: AID_LINKS.idoc }],
      done: DONE.has(fa.idocStatus ?? "n_a"),
    });
  }
  return steps;
}
