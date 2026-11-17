import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { CliError } from "./errors";
import type { Session } from "./session";

/**
 * Signs in through Forge's own OAuth server, like an assistant connector does, but returning to a
 * one-time listener on this computer (127.0.0.1). Asks for the "logins" scope, which Forge only grants to
 * loopback addresses, so `creds` and `1password` can read saved passwords.
 */

const SCOPE = "applications logins";
const WAIT_MS = 5 * 60 * 1000;

type Tokens = { access_token: string; refresh_token: string; expires_in: number };

export function authorizeUrl(base: string, clientId: string, redirectUri: string, challenge: string, state: string): string {
  const u = new URL("/oauth/authorize", base);
  u.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", scope: SCOPE, state }).toString();
  return u.toString();
}

async function post<T>(url: string, body: Record<string, string>, form = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": form ? "application/x-www-form-urlencoded" : "application/json" },
      body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
    });
  } catch {
    throw new CliError(`Couldn't reach ${new URL(url).origin}. Check your connection and try again.`);
  }
  const json = (await res.json().catch(() => ({}))) as T & { error_description?: string; error?: string };
  if (!res.ok) throw new CliError(json.error_description || json.error || `Forge answered ${res.status}.`);
  return json;
}

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    // The link is printed too.
  }
}

/** Waits for Forge to send the browser back with a code. Resolves with the code, after checking `state`. */
function listen(state: string): Promise<{ redirectUri: string; code: Promise<string> }> {
  return new Promise((ready, fail) => {
    let settle: (code: string) => void = () => undefined;
    let reject: (err: Error) => void = () => undefined;
    const code = new Promise<string>((res, rej) => ((settle = res), (reject = rej)));
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (u.pathname !== "/callback") return void res.writeHead(404).end();
      const ok = u.searchParams.get("state") === state && !!u.searchParams.get("code");
      res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
      res.end(ok ? "<p>Signed in to collegeforge. You can close this tab.</p>" : "<p>Sign-in didn't finish. Run collegeforge login again.</p>");
      server.close();
      clearTimeout(timer);
      if (ok) settle(u.searchParams.get("code")!);
      else reject(new CliError(u.searchParams.get("error") === "access_denied" ? "Sign-in was cancelled." : "Sign-in didn't finish. Run collegeforge login again."));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new CliError("Sign-in timed out. Run collegeforge login again."));
    }, WAIT_MS);
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return fail(new CliError("Couldn't open a local port for sign-in."));
      ready({ redirectUri: `http://127.0.0.1:${address.port}/callback`, code });
    });
  });
}

export async function signIn(base: string): Promise<Session> {
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const { redirectUri, code } = await listen(state);
  const client = await post<{ client_id: string }>(`${base}/oauth/register`, { client_name: "collegeforge command-line tool", redirect_uris: [redirectUri] } as never);
  const url = authorizeUrl(base, client.client_id, redirectUri, challenge, state);
  process.stderr.write(`Opening Forge in your browser to sign in. If it doesn't open, visit:\n  ${url}\n`);
  openBrowser(url);
  const tokens = await post<Tokens>(`${base}/oauth/token`, { grant_type: "authorization_code", code: await code, redirect_uri: redirectUri, code_verifier: verifier, client_id: client.client_id }, true);
  return { url: base, clientId: client.client_id, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
}

export async function refresh(session: Session): Promise<Session> {
  const tokens = await post<Tokens>(`${session.url}/oauth/token`, { grant_type: "refresh_token", refresh_token: session.refreshToken, client_id: session.clientId }, true);
  return { ...session, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
}
