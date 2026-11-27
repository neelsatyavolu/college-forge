/**
 * Copilot tools for the last things only the UI could change: an essay's draft/final mark, the
 * portal-check and email settings, and sourced research facts on a school. Portal passwords are
 * deliberately not exposed: students enter those in the Applications tab, never in a chat.
 */
import type { ToolSpec } from "./chat-types";
import { getWorkspace, type EssayStatus, type Workspace } from "./store";
import { setAutocheck, setEmails } from "./tracker-service";
import { INTERVIEW_TOOL_SPECS, mergeResearch } from "./interview-tools";
import { draftRecRequest } from "./recommenders";
import { withEssayVisibility } from "./essay-tools";

type Args = Record<string, unknown>;
type Mutate = (fn: (ws: Workspace) => Workspace) => Promise<Workspace>;

const researchSpec = INTERVIEW_TOOL_SPECS.find((t) => t.name === "set_school_research")!;

export const EXTRA_TOOL_SPECS: ToolSpec[] = [
  {
    name: "set_essay_status",
    description: "Mark an essay (by id from list_essays or get_essay) as 'draft' or 'final', or 'clear' to remove the mark. Only when the student says so.",
    parameters: { type: "object", properties: { essay_id: { type: "string" }, status: { type: "string", enum: ["draft", "final", "clear"] } }, required: ["essay_id", "status"], additionalProperties: false },
  },
  {
    name: "set_essay_visibility",
    description: "Only when the student asks: hide essays they won't write (hide: ids), show hidden ones again (show: ids), or choose their Common App personal essay prompt (common_app_prompt: a ca-ps-* id, or 'clear' to show all six again). Hidden essays keep their drafts.",
    parameters: { type: "object", properties: { hide: { type: "array", items: { type: "string" } }, show: { type: "array", items: { type: "string" } }, common_app_prompt: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "set_portal_settings",
    description: "Turn Forge's automatic portal checks on or off (autocheck), and whether Forge emails the student when a portal changes (emails). Pass only what the student asked to change.",
    parameters: { type: "object", properties: { autocheck: { type: "string", enum: ["yes", "no"] }, emails: { type: "string", enum: ["yes", "no"] } }, additionalProperties: false },
  },
  researchSpec,
  {
    name: "draft_rec_request",
    description: "Draft a polite recommendation-letter request email and a brag-sheet outline for one recommender (id or name from the letters tracker), from the student's saved activities, intended major and the teacher's subject. Returns text only; show it to the student to edit and send themselves. Never send it or claim it was sent.",
    parameters: { type: "object", properties: { recommender: { type: "string" } }, required: ["recommender"], additionalProperties: false },
  },
];

const allEssayIds = (ws: Workspace) => new Set([...ws.essays.commonApp, ...Object.values(ws.essays.supplements).flat()].map((e) => e.id));

/** Null when `name` isn't one of these tools. `read` returns the chat's workspace and refuses one reset since the chat began. */
export async function runExtraTool(
  workspaceId: string, mutate: Mutate, name: string, a: Args, read: () => Promise<Workspace> = () => getWorkspace(workspaceId),
): Promise<string | null> {
  switch (name) {
    case "set_essay_status": {
      const id = typeof a.essay_id === "string" ? a.essay_id.trim() : "";
      const status = a.status;
      if (!id || !["draft", "final", "clear"].includes(String(status))) return "set_essay_status needs essay_id and status (draft | final | clear).";
      let missing = false;
      await mutate((ws) => {
        missing = false;
        if (!allEssayIds(ws).has(id)) { missing = true; return ws; }
        const { [id]: _old, ...rest } = ws.essayStatus ?? {};
        return { ...ws, essayStatus: status === "clear" ? rest : { ...rest, [id]: status as EssayStatus } };
      });
      return missing ? `No essay with id "${id}". Use list_essays for ids.` : `Marked ${id} ${status === "clear" ? "unmarked" : status}.`;
    }
    case "set_essay_visibility": {
      const prompt = a.common_app_prompt === "clear" ? null : a.common_app_prompt;
      let reply = "";
      await mutate((ws) => {
        const r = withEssayVisibility(ws, { hide: a.hide, show: a.show, commonAppPrompt: prompt });
        if (!r.ok) { reply = r.error; return ws; }
        const hidden = Object.keys(r.value.essayHidden ?? {}).length;
        reply = `Saved. ${hidden} essay${hidden === 1 ? "" : "s"} hidden${r.value.commonAppPrompt ? `; Common App prompt: ${r.value.commonAppPrompt}` : ""}.`;
        return r.value;
      });
      return reply;
    }
    case "set_portal_settings": {
      const done: string[] = [];
      if (a.autocheck === "yes" || a.autocheck === "no") { await setAutocheck(workspaceId, a.autocheck === "yes"); done.push(`automatic checks ${a.autocheck === "yes" ? "on" : "off"}`); }
      if (a.emails === "yes" || a.emails === "no") { await setEmails(workspaceId, a.emails === "yes"); done.push(`portal emails ${a.emails === "yes" ? "on" : "off"}`); }
      return done.length ? `Saved: ${done.join(", ")}.` : "Nothing to change: pass autocheck and/or emails as yes or no.";
    }
    case "set_school_research": {
      let reply = "";
      await mutate((ws) => {
        const r = mergeResearch(ws, a);
        if ("error" in r) { reply = r.error; return ws; }
        reply = `Saved ${r.saved} facts on ${r.college.name}${r.dropped ? `; dropped ${r.dropped} without a valid key, https source or cycle` : ""}.`;
        return r.ws;
      });
      return reply;
    }
    case "draft_rec_request": {
      const key = typeof a.recommender === "string" ? a.recommender.trim().toLowerCase() : "";
      if (!key) return "draft_rec_request needs a recommender id or name.";
      const ws = await read();
      const rec = ws.recommendations.find((r) => String(r.id).toLowerCase() === key) ?? ws.recommendations.find((r) => String(r.name).toLowerCase().includes(key));
      if (!rec) return `No recommender matching "${key}". Add them on the Letters & aid page first.`;
      return `Draft for ${rec.name}. Show it to the student to edit and send themselves:\n\n${draftRecRequest(ws, rec)}`;
    }
    default:
      return null;
  }
}
