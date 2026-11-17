import { CliError, NOT_SIGNED_IN } from "./errors";
import type { Login, School } from "./format";
import { refresh } from "./oauth";
import { readSession, saveSession, type Session } from "./session";

/** Forge's MCP tools and the CLI-only logins endpoint, with the saved session refreshed as needed. */
export class Forge {
  private constructor(private session: Session) {}

  static async open(): Promise<Forge> {
    const session = await readSession();
    if (!session) throw new CliError("Not signed in. Run: collegeforge login", NOT_SIGNED_IN);
    return new Forge(session);
  }

  get url(): string {
    return this.session.url;
  }

  private async token(): Promise<string> {
    if (this.session.expiresAt - Date.now() > 60_000) return this.session.accessToken;
    try {
      this.session = await refresh(this.session);
    } catch {
      throw new CliError("Your sign-in ended. Run: collegeforge login", NOT_SIGNED_IN);
    }
    await saveSession(this.session);
    return this.session.accessToken;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.session.url}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${await this.token()}` } });
    } catch {
      throw new CliError(`Couldn't reach ${this.session.url}. Check your connection and try again.`);
    }
    if (res.status === 401) throw new CliError("Your sign-in ended or was disconnected in Forge. Run: collegeforge login", NOT_SIGNED_IN);
    return res;
  }

  async tool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = await this.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const body = (await res.json().catch(() => ({}))) as { result?: { isError?: boolean; structuredContent?: T; content?: { text?: string }[] }; error?: { message: string } };
    if (body.error) throw new CliError(body.error.message);
    if (!body.result || body.result.isError) throw new CliError(body.result?.content?.[0]?.text ?? `Forge answered ${res.status}.`);
    return body.result.structuredContent as T;
  }

  async schools(): Promise<School[]> {
    return (await this.tool<{ applications: School[] }>("list_applications")).applications;
  }

  async logins(ids?: string[]): Promise<Record<string, Login>> {
    const res = await this.request(`/api/cli/logins${ids?.length ? `?ids=${encodeURIComponent(ids.join(","))}` : ""}`);
    const body = (await res.json().catch(() => ({}))) as { logins?: Record<string, Login>; error?: string };
    if (!res.ok || !body.logins) throw new CliError(body.error ?? `Forge answered ${res.status}.`, res.status === 403 ? NOT_SIGNED_IN : 1);
    return body.logins;
  }
}
