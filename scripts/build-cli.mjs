// Bundles the collegeforge command-line tool into one dependency-free file served at /cli/collegeforge.mjs.
import { build } from "esbuild";

await build({
  entryPoints: ["cli/main.ts"],
  outfile: "public/cli/collegeforge.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: false,
  legalComments: "none",
  banner: { js: "#!/usr/bin/env node" },
});
