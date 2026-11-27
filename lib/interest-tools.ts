import { z } from "zod";
import { INTEREST_KINDS } from "./interest-log";
import { addInterestTo, interviewPrepBrief, listInterest, updateInterest } from "./interest-service";

/**
 * MCP tools for the interest and interview log. lib/mcp-tools.ts lists them and lib/copilot-bridge-tools.ts
 * gives them to the in-app copilot, so both run the same validated code.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd");
const fields = {
  time: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, 24-hour")]).optional(),
  who: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
  prep: z.string().max(4000).optional(),
  thank_you_sent: z.boolean().optional(),
  done: z.boolean().optional(),
};
type Fields = { time?: string; who?: string; notes?: string; prep?: string; thank_you_sent?: boolean; done?: boolean };
const toInput = ({ thank_you_sent, ...f }: Fields) => ({ ...f, ...(thank_you_sent !== undefined ? { thankYouSent: thank_you_sent } : {}) });

const KINDS = INTEREST_KINDS.join(", ");

export const INTEREST_TOOLS = [
  {
    name: "list_interest",
    title: "List demonstrated interest",
    description:
      "For each application (or one `school`): whether the school counts demonstrated interest and how it uses interviews (parsed from sourced research, with the quote and source), what the student logged (visits, info sessions, fairs, interviews, admissions officer contact), and a nudge when something is due. Also lists interviews coming up and thank-you notes owed.",
    input: z.object({ school: z.string().min(1).optional() }),
    readOnly: true,
    run: async (ws: string, { school }: { school?: string }) => listInterest(ws, school),
  },
  {
    name: "log_interest",
    title: "Log interest or an interview",
    description: `Logs one contact with a school: kind (${KINDS}), date (yyyy-mm-dd), optional time (HH:MM), who (interviewer, regional admissions officer or event), notes. A future interview shows on the student's calendar and Progress page. Up to 50 per school. Log only what the student told you happened or is booked.`,
    input: z.object({ school: z.string().min(1), kind: z.enum(INTEREST_KINDS), date: day, ...fields }),
    readOnly: false,
    run: async (ws: string, { school, kind, date, ...f }: { school: string; kind: string; date: string } & Fields) =>
      addInterestTo(ws, school, { kind, date, ...toInput(f) }).then((a) => ({ school: a.name, events: a.interest, policy: a.interestSignal })),
  },
  {
    name: "set_interest",
    title: "Update or remove an interest entry",
    description: `Changes one logged entry (ids from list_interest): kind (${KINDS}), date, time, who, notes, prep (interview prep notes), done, thank_you_sent; or remove: true. Only the fields you pass change.`,
    input: z.object({ school: z.string().min(1), entry_id: z.string().min(1).max(40), kind: z.enum(INTEREST_KINDS).optional(), date: day.optional(), ...fields, remove: z.boolean().optional() }),
    readOnly: false,
    run: async (ws: string, { school, entry_id, ...f }: { school: string; entry_id: string; kind?: string; date?: string; remove?: boolean } & Fields) =>
      updateInterest(ws, school, entry_id, toInput(f)).then((a) => ({ school: a.name, events: a.interest, policy: a.interestSignal })),
  },
  {
    name: "interview_prep",
    title: "Interview prep material",
    description:
      "Gathers what you need to help the student prepare for an interview at one school: its sourced facts, the student's activities, intended major and why-us drafts, and the interview logged (or the one given by entry_id). Then draft 8 likely questions with talking points from that material only and, once the student has seen them, save them with set_interest (prep).",
    input: z.object({ school: z.string().min(1), entry_id: z.string().min(1).max(40).optional() }),
    readOnly: true,
    run: async (ws: string, { school, entry_id }: { school: string; entry_id?: string }) => interviewPrepBrief(ws, school, entry_id),
  },
];
