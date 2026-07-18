import type { ToolSpec, ToolExecutor } from "./chat-types";
import { runWebSearch } from "./web-search-tool";
import {
  getWorkspace,
  saveWorkspace,
  readUpload,
  type Workspace,
  type College,
} from "./store";
import { slugify, upsertCollegeInto, removeCollegeFrom } from "./colleges";

// Only copy keys the caller actually provided, so partial updates never wipe
// existing fields with undefined.
function assignDefined<T extends object>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out as T;
}

type Args = Record<string, unknown>;

/**
 * Builds the copilot's tool set for one workspace. Every mutating tool loads
 * the workspace, applies an immutable change, persists it, and returns a short
 * confirmation the model relays to the user. The hub UI re-fetches the
 * workspace after each turn, so these writes show up on the page immediately.
 */
export function makeHubTools(workspaceId: string): { tools: ToolSpec[]; executeTool: ToolExecutor } {
  const wsTag = workspaceId.slice(0, 8);

  async function mutate(fn: (ws: Workspace) => Workspace): Promise<Workspace> {
    const ws = await getWorkspace(workspaceId);
    const next = fn(ws);
    await saveWorkspace(workspaceId, next);
    console.log(
      `[hub-tools] ws=${wsTag} persisted colleges=${next.colleges.length} ` +
        `activities=${next.profile.activities.length} honors=${next.profile.honors.length} ` +
        `dates=${next.criticalDates.length} ed=${next.ed ? next.ed.school : "none"}`
    );
    return next;
  }

  const tools: ToolSpec[] = [
    {
      name: "read_upload",
      description:
        "Read the full text of a file the user uploaded to their hub (transcript, resume, award list, college list, essay draft, etc.). Use this FIRST whenever uploads are listed in the system prompt, then extract structured data and write it with the other tools.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Exact upload filename from the system prompt." } },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "set_applicant_snapshot",
      description:
        "Set the top-line applicant snapshot shown on the Overview and Profile pages. Provide only the fields you know. GPAs and SAT are strings (e.g. '4.28', '1540').",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" }, cycle: { type: "string", description: "e.g. 'Fall 2027'" },
          year: { type: "string", description: "e.g. 'Junior — May 2027'" },
          gpaWeighted: { type: "string" }, gpaUnweighted: { type: "string" },
          sat: { type: "string" }, satNote: { type: "string" }, awards: { type: "number" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "set_profile_identity",
      description: "Set profile identity fields (Profile page 'Applicant' panel).",
      parameters: {
        type: "object",
        properties: {
          intended: { type: "string", description: "Intended major / academic path" },
          hs: { type: "string", description: "High school name" },
          gradYear: { type: "number" }, location: { type: "string" },
          counselor: { type: "string" }, residency: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "set_testing",
      description: "Set testing details: SAT, a superscore/section note, and AP exams.",
      parameters: {
        type: "object",
        properties: {
          sat: { type: "string" }, satNote: { type: "string" },
          aps: {
            type: "array",
            items: {
              type: "object",
              properties: { course: { type: "string" }, score: { type: "string" } },
              required: ["course", "score"],
            },
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "set_coursework",
      description: "Set coursework lists shown on the Profile page.",
      parameters: {
        type: "object",
        properties: {
          honors: { type: "array", items: { type: "string" } },
          aps: { type: "array", items: { type: "string" } },
          senior: { type: "array", items: { type: "string" }, description: "Senior-year / planned courses" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "set_activities",
      description:
        "Replace the full activities list (Common App order, most important first). Include rank starting at 1.",
      parameters: {
        type: "object",
        properties: {
          activities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                rank: { type: "number" }, name: { type: "string" }, type: { type: "string" },
                org: { type: "string" }, years: { type: "string" }, role: { type: "string" },
                hpw: { type: "string", description: "hours per week" }, wpy: { type: "string", description: "weeks per year" },
                college: { type: "boolean", description: "intends to continue in college" },
                desc: { type: "string" }, bullets: { type: "array", items: { type: "string" } },
              },
              required: ["rank", "name", "type"],
            },
          },
        },
        required: ["activities"],
        additionalProperties: false,
      },
    },
    {
      name: "set_honors",
      description: "Replace the full honors & awards list. Mark the strongest ones with top:true.",
      parameters: {
        type: "object",
        properties: {
          honors: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                level: { type: "string", description: "National | International | State | School" },
                year: { type: "string" }, top: { type: "boolean" },
              },
              required: ["title", "level"],
            },
          },
        },
        required: ["honors"],
        additionalProperties: false,
      },
    },
    {
      name: "upsert_college",
      description:
        "Add or update a college on the user's list (matched by slug; slug is derived from the name if omitted). Set tier to 'reach' | 'target' | 'safety' and verdict for the colored badge. Fill as many fields as you can from research.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" }, short: { type: "string", description: "Short display name, e.g. 'MIT'" },
          slug: { type: "string" }, location: { type: "string", description: "'City, ST · Setting'" },
          setting: { type: "string", description: "urban | suburban | town" }, rank: { type: "number" },
          admit: { type: "string" }, satRange: { type: "string" }, gpa: { type: "string" },
          tier: { type: "string", description: "reach | target | safety" },
          verdict: {
            type: "object",
            properties: { tone: { type: "string", description: "top | good | caution" }, label: { type: "string" } },
          },
          priority: { type: "boolean", description: "true for the top ED/priority school" },
          major: { type: "string" }, deadline: { type: "string", description: "e.g. 'ED · Nov 1'" },
          supp: { type: "string", description: "No supps | Supps optional | Supps required" },
          tags: {
            type: "array",
            items: { type: "object", properties: { label: { type: "string" }, tone: { type: "string" } } },
          },
          size: { type: "string" }, act: { type: "string" }, netPrice: { type: "string" },
          grad6: { type: "string" }, earnings: { type: "string" }, fee: { type: "string" }, transfer: { type: "string" },
          plans: {
            type: "array",
            items: { type: "object", properties: { plan: { type: "string" }, rate: { type: "string" } } },
          },
          deadlines: {
            type: "array",
            items: { type: "object", properties: { plan: { type: "string" }, date: { type: "string" } } },
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "remove_college",
      description: "Remove a college from the list by slug.",
      parameters: {
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
        additionalProperties: false,
      },
    },
    {
      name: "set_early_decision",
      description: "Set the priority Early Decision school shown on the Overview page. Pass school:null to clear it.",
      parameters: {
        type: "object",
        properties: {
          school: { type: ["string", "null"] },
          deadline: { type: "string", description: "ISO date 'YYYY-MM-DD'" },
          daysLeft: { type: "number" }, reason: { type: "string" },
        },
        required: ["school"],
        additionalProperties: false,
      },
    },
    {
      name: "set_critical_dates",
      description: "Replace the Overview 'Critical dates' list.",
      parameters: {
        type: "object",
        properties: {
          dates: {
            type: "array",
            items: {
              type: "object",
              properties: { date: { type: "string" }, label: { type: "string" }, detail: { type: "string" } },
              required: ["date", "label"],
            },
          },
        },
        required: ["dates"],
        additionalProperties: false,
      },
    },
    {
      name: "set_essays",
      description:
        "Set essay prompts/editors. commonApp is a list of Common App essays; supplements maps a college slug to its supplement essays. Each essay needs id, label, prompt, limit, unit ('words').",
      parameters: {
        type: "object",
        properties: {
          commonApp: { type: "array", items: { type: "object" } },
          supplements: { type: "object", description: "{ '<college-slug>': [essay, …] }" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "web_search",
      description:
        "Search the web for up-to-date facts (admit rates, deadlines, test ranges, rankings) when populating colleges or answering questions.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "set_recommendations",
      description:
        "Replace the recommendation-letter tracker list. status ∈ not_asked | asked | in_progress | submitted | waived. type ∈ counselor | teacher | other.",
      parameters: {
        type: "object",
        properties: {
          recommendations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                type: { type: "string" },
                subject: { type: "string" },
                status: { type: "string" },
                deadline: { type: "string" },
                notes: { type: "string" },
              },
              required: ["name", "type"],
            },
          },
        },
        required: ["recommendations"],
        additionalProperties: false,
      },
    },
    {
      name: "set_scholarships",
      description:
        "Replace the scholarship tracker. status ∈ researching | in_progress | submitted | won | lost | skipped.",
      parameters: {
        type: "object",
        properties: {
          scholarships: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                amount: { type: "string" },
                deadline: { type: "string" },
                status: { type: "string" },
                url: { type: "string" },
                notes: { type: "string" },
              },
              required: ["name"],
            },
          },
        },
        required: ["scholarships"],
        additionalProperties: false,
      },
    },
    {
      name: "set_financial_aid",
      description:
        "Update FAFSA/CSS Profile checklist. fafsaStatus/cssStatus ∈ not_started | in_progress | submitted | processed (css also n_a).",
      parameters: {
        type: "object",
        properties: {
          fafsaStatus: { type: "string" },
          cssStatus: { type: "string" },
          fafsaOpenDate: { type: "string" },
          notes: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "set_application_status",
      description:
        "Set pipeline status for one school. status ∈ researching | preparing | submitted | accepted | rejected | waitlisted | deferred | withdrawn.",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string" },
          status: { type: "string" },
          submittedAt: { type: "string" },
          decisionAt: { type: "string" },
          notes: { type: "string" },
        },
        required: ["slug", "status"],
        additionalProperties: false,
      },
    },
  ];

  const executeTool: ToolExecutor = async (name, argsJson) => {
    // Logged so `vercel logs` shows exactly which tools the model invoked and
    // with what — the fastest way to tell "AI claimed it updated" from
    // "AI actually called a tool".
    console.log(`[hub-tools] ws=${wsTag} CALL ${name} args=${(argsJson || "{}").slice(0, 300)}`);
    let a: Args;
    try {
      a = JSON.parse(argsJson || "{}");
    } catch {
      console.error(`[hub-tools] ws=${wsTag} ${name} — invalid JSON args`);
      return `Invalid JSON arguments for ${name}.`;
    }

    try {
      switch (name) {
        case "read_upload": {
          if (typeof a.name !== "string") return "read_upload requires a string 'name'.";
          const text = await readUpload(workspaceId, a.name);
          return text === null ? `No upload named "${a.name}" was found.` : text;
        }
        case "web_search": {
          if (typeof a.query !== "string") return "web_search requires a string 'query'.";
          const r = await runWebSearch(a.query);
          return r.ok ? r.content : r.error;
        }
        case "set_applicant_snapshot": {
          await mutate((ws) => ({ ...ws, applicant: assignDefined(ws.applicant, a) }));
          return "Updated the applicant snapshot.";
        }
        case "set_profile_identity": {
          await mutate((ws) => ({ ...ws, profile: assignDefined(ws.profile, a) }));
          return "Updated profile identity.";
        }
        case "set_testing": {
          await mutate((ws) => ({
            ...ws,
            profile: { ...ws.profile, testing: assignDefined(ws.profile.testing, a) },
          }));
          return "Updated testing.";
        }
        case "set_coursework": {
          await mutate((ws) => ({
            ...ws,
            profile: { ...ws.profile, coursework: assignDefined(ws.profile.coursework, a) },
          }));
          return "Updated coursework.";
        }
        case "set_activities": {
          if (!Array.isArray(a.activities)) return "set_activities requires an 'activities' array.";
          await mutate((ws) => ({
            ...ws,
            profile: { ...ws.profile, activities: a.activities as Workspace["profile"]["activities"] },
          }));
          return `Saved ${(a.activities as unknown[]).length} activities.`;
        }
        case "set_honors": {
          if (!Array.isArray(a.honors)) return "set_honors requires a 'honors' array.";
          const honors = a.honors as Workspace["profile"]["honors"];
          await mutate((ws) => ({
            ...ws,
            profile: { ...ws.profile, honors },
            applicant: { ...ws.applicant, awards: honors.length },
          }));
          return `Saved ${honors.length} honors.`;
        }
        case "upsert_college": {
          if (typeof a.name !== "string") return "upsert_college requires a 'name'.";
          const slug = typeof a.slug === "string" && a.slug ? a.slug : slugify(a.name);
          const short = typeof a.short === "string" && a.short ? a.short : a.name;
          const incoming = { ...a, slug, short } as unknown as College;
          await mutate((ws) => upsertCollegeInto(ws, incoming));
          return `Saved "${a.name}" to the school list${a.tier ? ` as a ${a.tier}` : ""}.`;
        }
        case "remove_college": {
          if (typeof a.slug !== "string") return "remove_college requires a 'slug'.";
          await mutate((ws) => removeCollegeFrom(ws, a.slug as string));
          return `Removed ${a.slug}.`;
        }
        case "set_early_decision": {
          await mutate((ws) => ({
            ...ws,
            ed:
              a.school === null || a.school === ""
                ? null
                : {
                    school: String(a.school),
                    deadline: typeof a.deadline === "string" ? a.deadline : "",
                    daysLeft: typeof a.daysLeft === "number" ? a.daysLeft : "",
                    reason: typeof a.reason === "string" ? a.reason : "",
                  },
          }));
          return a.school ? `Set Early Decision to ${a.school}.` : "Cleared Early Decision.";
        }
        case "set_critical_dates": {
          if (!Array.isArray(a.dates)) return "set_critical_dates requires a 'dates' array.";
          await mutate((ws) => ({ ...ws, criticalDates: a.dates as Workspace["criticalDates"] }));
          return `Saved ${(a.dates as unknown[]).length} critical dates.`;
        }
        case "set_essays": {
          await mutate((ws) => ({
            ...ws,
            essays: {
              commonApp: Array.isArray(a.commonApp)
                ? (a.commonApp as Workspace["essays"]["commonApp"])
                : ws.essays.commonApp,
              supplements:
                a.supplements && typeof a.supplements === "object"
                  ? (a.supplements as Workspace["essays"]["supplements"])
                  : ws.essays.supplements,
            },
          }));
          return "Updated essays.";
        }
        case "set_recommendations": {
          if (!Array.isArray(a.recommendations)) return "set_recommendations requires a recommendations array.";
          const recommendations = (a.recommendations as Workspace["recommendations"]).map((r, i) => ({
            ...r,
            id: r.id || `rec-${i + 1}`,
            status: r.status || "not_asked",
          }));
          await mutate((ws) => ({ ...ws, recommendations }));
          return `Saved ${recommendations.length} recommenders.`;
        }
        case "set_scholarships": {
          if (!Array.isArray(a.scholarships)) return "set_scholarships requires a scholarships array.";
          const scholarships = (a.scholarships as Workspace["scholarships"]).map((s, i) => ({
            ...s,
            id: s.id || `sch-${i + 1}`,
            status: s.status || "researching",
          }));
          await mutate((ws) => ({ ...ws, scholarships }));
          return `Saved ${scholarships.length} scholarships.`;
        }
        case "set_financial_aid": {
          await mutate((ws) => ({
            ...ws,
            financialAid: {
              ...ws.financialAid,
              ...(typeof a.fafsaStatus === "string" ? { fafsaStatus: a.fafsaStatus as Workspace["financialAid"]["fafsaStatus"] } : {}),
              ...(typeof a.cssStatus === "string" ? { cssStatus: a.cssStatus as Workspace["financialAid"]["cssStatus"] } : {}),
              ...(typeof a.fafsaOpenDate === "string" ? { fafsaOpenDate: a.fafsaOpenDate } : {}),
              ...(typeof a.notes === "string" ? { notes: a.notes } : {}),
            },
          }));
          return "Updated financial aid checklist.";
        }
        case "set_application_status": {
          if (typeof a.slug !== "string" || typeof a.status !== "string") {
            return "set_application_status requires slug and status.";
          }
          await mutate((ws) => ({
            ...ws,
            applications: {
              ...ws.applications,
              [a.slug as string]: {
                status: a.status as Workspace["applications"][string]["status"],
                submittedAt: typeof a.submittedAt === "string" ? a.submittedAt : ws.applications[a.slug as string]?.submittedAt,
                decisionAt: typeof a.decisionAt === "string" ? a.decisionAt : ws.applications[a.slug as string]?.decisionAt,
                notes: typeof a.notes === "string" ? a.notes : ws.applications[a.slug as string]?.notes,
              },
            },
          }));
          return `Set ${a.slug} status to ${a.status}.`;
        }
        default:
          console.error(`[hub-tools] ws=${wsTag} unknown tool ${name}`);
          return `Unknown tool: ${name}`;
      }
    } catch (err) {
      // Surfaced to the model AND to the logs — a silently failing write is
      // exactly how "the AI said it updated but the page is blank" happens.
      console.error(`[hub-tools] ws=${wsTag} ${name} FAILED:`, err);
      return `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  };

  return { tools, executeTool };
}
