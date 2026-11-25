// Validate school research files: node scripts/research/validate.mjs [slug ...]
// With no slugs, checks every file listed in lib/school-research/manifest.json that exists.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
require.extensions[".ts"] = (mod, file) =>
  mod._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true } }).outputText, file);
const { validateSchoolResearch } = require("../../lib/school-research.ts");

const dir = path.resolve("lib/school-research");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
const slugs = process.argv.slice(2).length ? process.argv.slice(2) : manifest.schools.map((s) => s.slug);
let bad = 0, missing = 0, ok = 0;
for (const slug of slugs) {
  const file = path.join(dir, `${slug}.json`);
  if (!fs.existsSync(file)) { missing++; continue; }
  let errs;
  try { errs = validateSchoolResearch(JSON.parse(fs.readFileSync(file, "utf8"))); } catch (e) { errs = [`invalid JSON: ${e.message}`]; }
  if (errs.length) { bad++; console.log(`${slug}: ${errs.slice(0, 8).join("; ")}`); } else ok++;
}
console.log(`ok ${ok}, invalid ${bad}, missing ${missing}`);
process.exit(bad ? 1 : 0);
