import { Forge } from "./api";
import { parseArgs, type Args } from "./args";
import { CliError, NOT_SIGNED_IN } from "./errors";
import { credsText, detailText, findSchool, listText, type School } from "./format";
import { signIn } from "./oauth";
import { saveTo1Password, type Picked } from "./onepassword";
import { clearSession, saveSession, sessionPath } from "./session";

const VERSION = "1.0.0";
const DEFAULT_URL = "https://forge.xanom.co";

const HELP = `collegeforge ${VERSION}: your Forge schools, statuses and portal logins from the terminal.

Usage:
  collegeforge login                          sign in through your browser
  collegeforge logout
  collegeforge whoami
  collegeforge list [--json]                  every school: status, round, next date, what the portal says
  collegeforge show <school> [--json]         one school in full (no passwords)
  collegeforge creds <school> [--json]        portal link, username and password
  collegeforge check [<school>] [--json]      sign in to portals now and report what they say
  collegeforge 1password (<school>... | --all) [--vault <name>] [--dry-run]
                                              copy portal logins into 1Password with the op CLI

<school> is the school's name or a unique part of it (michigan), or its id from --json output.
A decision a portal posted is only reported as received; open the portal or Forge to see it.
"1password" skips logins already there (tagged collegeforge, or collegeapps from the older tool).

Signing in saves a token in ${sessionPath()} (readable only by you) that can read your saved
portal passwords. "logout" deletes it; you can also disconnect it in Forge settings.

Environment:
  COLLEGEFORGE_URL   another server (default ${DEFAULT_URL})

Exit codes: 0 ok, 1 error, 2 not signed in.`;

function print(value: unknown, json: boolean, text: () => string): void {
  process.stdout.write((json ? JSON.stringify(value, null, 2) : text()) + "\n");
}

function oneSchool(args: Args): string {
  const query = args.positionals.join(" ");
  if (!query) throw new CliError(`Name a school: collegeforge ${args.command} <school>`);
  return query;
}

async function login(): Promise<void> {
  const url = (process.env.COLLEGEFORGE_URL || DEFAULT_URL).replace(/\/+$/, "");
  const session = await signIn(url);
  await saveSession(session);
  const count = (await (await Forge.open()).schools()).length;
  process.stderr.write(`Signed in to ${url}. ${count} school${count === 1 ? "" : "s"}.\n`);
}

async function check(forge: Forge, args: Args, json: boolean): Promise<void> {
  const school = args.positionals.length ? findSchool(await forge.schools(), oneSchool(args)) : null;
  process.stderr.write(school ? `Checking ${school.school}…\n` : "Checking every portal with a saved login. This can take a minute…\n");
  const out = await forge.tool<{ checked: number; note?: string; applications?: School[] }>("check_portals", school ? { school: school.id } : {});
  print(out, json, () => (out.applications?.length ? listText(out.applications) : (out.note ?? "Nothing to check.")));
}

async function onePassword(forge: Forge, args: Args): Promise<void> {
  const all = await forge.schools();
  const named = args.positionals.map((q) => findSchool(all, q));
  if (!named.length && !args.flags.all) throw new CliError("Name the schools to copy, or use --all for every saved login.");
  const from = named.length ? named : all;
  const logins = await forge.logins(from.map((s) => s.id));
  const picked: Picked[] = from.flatMap((s) => {
    const l = logins[s.id];
    return l ? [{ school: s.school, portalUrl: l.portalUrl || s.portal_link || "", username: l.username, password: l.password }] : [];
  });
  if (!picked.length) throw new CliError(named.length ? "Those schools have no saved logins." : "No logins are saved in Forge yet.");
  const vault = typeof args.flags.vault === "string" ? args.flags.vault : undefined;
  const dryRun = !!args.flags["dry-run"];
  const report = await saveTo1Password(picked, { vault, dryRun });
  const line = (p: Picked) => `${p.school} (${p.username})`;
  print(
    {
      dryRun,
      created: report.created.map((p) => ({ school: p.school, username: p.username })),
      skipped: report.skipped.map((p) => ({ school: p.school, username: p.username })),
      failed: report.failed.map((f) => ({ school: f.picked.school, username: f.picked.username, error: f.error })),
    },
    !!args.flags.json,
    () =>
      [
        ...report.created.map((p) => `${dryRun ? "would add" : "added"}  ${line(p)}`),
        ...report.skipped.map((p) => `already in 1Password  ${line(p)}`),
        ...report.failed.map((f) => `failed  ${line(f.picked)}: ${f.error}`),
      ].join("\n"),
  );
  if (report.failed.length) process.exitCode = 1;
}

async function run(args: Args): Promise<void> {
  const json = !!args.flags.json;
  if (args.flags.version || args.command === "version") return void process.stdout.write(VERSION + "\n");
  if (args.flags.help || args.command === "help") return void process.stdout.write(HELP + "\n");
  if (args.command === "login") return login();
  if (args.command === "logout") {
    await clearSession();
    return void process.stderr.write("Signed out. The saved token is deleted. To end it everywhere, disconnect collegeforge in Forge settings.\n");
  }
  const forge = await Forge.open();
  switch (args.command) {
    case "whoami": {
      const count = (await forge.schools()).length;
      return print({ url: forge.url, schools: count }, json, () => `Signed in to ${forge.url}. ${count} school${count === 1 ? "" : "s"}.`);
    }
    case "list": {
      const all = await forge.schools();
      return print(all, json, () => listText(all));
    }
    case "show": {
      const school = findSchool(await forge.schools(), oneSchool(args));
      return print(school, json, () => detailText(school));
    }
    case "creds": {
      const school = findSchool(await forge.schools(), oneSchool(args));
      const login = (await forge.logins([school.id]))[school.id];
      return print({ school: school.school, ...(login ?? { login: null }) }, json, () => credsText(school, login));
    }
    case "check":
      return check(forge, args, json);
    case "1password":
      return onePassword(forge, args);
    default:
      throw new CliError(`Unknown command "${args.command}". Run: collegeforge help`);
  }
}

run(parseArgs(process.argv.slice(2))).catch((err: unknown) => {
  if (err instanceof CliError) {
    const hint = err.exitCode === NOT_SIGNED_IN && !err.message.includes("collegeforge login") ? " Run: collegeforge login" : "";
    process.stderr.write(`collegeforge: ${err.message}${hint}\n`);
    process.exit(err.exitCode);
  }
  process.stderr.write(`collegeforge: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
