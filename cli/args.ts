export interface Args {
  command: string;
  positionals: string[];
  flags: Record<string, string | true>;
}

/** Flags that take a value when written as `--name value` instead of `--name=value`. */
const VALUE_FLAGS = new Set(["vault"]);

export function parseArgs(argv: string[]): Args {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h") flags.help = true;
    else if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (eq !== -1) flags[name] = arg.slice(eq + 1);
      else if (VALUE_FLAGS.has(name) && argv[i + 1] !== undefined) flags[name] = argv[++i]!;
      else flags[name] = true;
    } else positionals.push(arg);
  }
  const [command = "help", ...rest] = positionals;
  return { command, positionals: rest, flags };
}
