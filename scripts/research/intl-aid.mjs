#!/usr/bin/env node
/**
 * International student aid from each college's Common Data Set, section H6: whether institutional
 * need-based and non-need-based (merit) aid is available to nonresident (international) undergraduates,
 * how many were awarded aid, and the average award. Plain fetching only: the CDS links come from Forge's
 * audited research files (lib/school-research/*.json), and PDFs are read with scripts/research/fetch.py
 * (curl_cffi + pdftotext -layout). Re-run yearly when new CDS files are out; review the diff.
 *
 *   node scripts/research/intl-aid.mjs [--only slug,slug] > /dev/null   # writes public/data/international-aid.json
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RESEARCH_DIR = path.join(root, "lib/school-research");
const OUT = path.join(root, "public/data/international-aid.json");
// Official CDS links for colleges whose research files don't cite one (checked by hand; update yearly).
const EXTRA_LINKS = (() => { try { return JSON.parse(readFileSync(path.join(root, "scripts/research/cds-links.json"), "utf8")); } catch { return {}; } })();
const only = (() => { const i = process.argv.indexOf("--only"); return i > 0 ? new Set(process.argv[i + 1].split(",")) : null; })();

/** The Common Data Set link a research file cites, if any. */
export function cdsUrl(research) {
  return (research.facts || []).map((f) => f.sourceUrl).find((u) => /cds|common[-_ ]?data/i.test(u || "")) || null;
}

const money = (s) => (s ? Number(s.replace(/[$,]/g, "")) : null);

/** Parses section H6 of a CDS text (pdftotext -layout). Returns null when the section isn't there. */
export function parseH6(raw) {
  // HTML pages arrive as Markdown (**H6.**, tables with | and _X_); PDFs as laid-out text. Normalize both.
  const text = raw.replace(/\*\*/g, "").replace(/_([xX])_/g, " $1 ").replace(/\|/g, " ")
    // Page headers and footers ("Common Data Set 2025-2026", "CDS-H", "Page 2") end in stray numbers.
    .split("\n").filter((l) => !/Common Data Set|CDS-H|Page \d+\s*$/i.test(l)).join("\n");
  // The H6 item itself ("H6. Indicate your institution's policy..."), not a sentence that wraps to "H6 below:".
  const start = text.search(/^\s*H6\b(?!\s+below)/m);
  if (start < 0) return null;
  const rest = text.slice(start);
  const end = rest.slice(3).search(/^\s*(H7|H8|Section I|I\.\s|I1)\b/m);
  const block = end > 0 ? rest.slice(0, end + 3) : rest.slice(0, 2500);
  const checked = (phrase) => {
    const line = block.split("\n").find((l) => new RegExp(phrase, "i").test(l));
    return !!line && /(^|\s)[xX✓☒■](\s|$)/.test(line.replace(new RegExp(phrase, "i"), " "));
  };
  const needBased = checked("Institutional need-based scholarship or grant aid is available");
  const meritBased = checked("non-need-based scholarship or grant aid is available");
  const none = checked("scholarship (?:or|and) grant aid is not available");
  const countBlock = block.slice(Math.max(0, block.search(/provide the number/i))).split(/Average dollar amount/i)[0];
  const awardedMatch = /(?:^|\s)(\d{1,3}(?:,\d{3})+|\d+)\s*$/m.exec(countBlock);
  const avgMatch = /Average dollar amount[^$\n]*\$\s?([\d,]+)/i.exec(block) || /Average dollar amount[\s\S]{0,300}?\$\s?([\d,]+)/i.exec(block);
  const totalMatch = /Total dollar amount[^$\n]*\$\s?([\d,]+)/i.exec(block);
  // An average under $500 is a stray digit from the layout, not an award.
  const average = avgMatch && money(avgMatch[1]) >= 500 ? money(avgMatch[1]) : null;
  return {
    // "Not available" is only believed when no aid box is checked and no award is reported.
    needBased, meritBased, none: none && !needBased && !meritBased && !average,
    awarded: awardedMatch ? Number(awardedMatch[1].replace(/,/g, "")) : null,
    average,
    total: totalMatch ? money(totalMatch[1]) : null,
  };
}

/** A public Google Drive or Box viewer link turned into its file download link; other URLs unchanged. */
export function downloadUrl(url) {
  const drive = /drive\.google\.com\/file\/d\/([\w-]+)/.exec(url) || /drive\.google\.com\/open\?id=([\w-]+)/.exec(url);
  if (drive) return { url: `https://drive.google.com/uc?export=download&id=${drive[1]}`, pdf: true };
  const box = /^https:\/\/([\w-]+\.)?box\.com\/s\/([\w]+)/.exec(url);
  if (box) return { url: `https://${box[1] || ""}box.com/shared/static/${box[2]}`, pdf: true };
  return { url, pdf: /\.pdf(\?|$)/i.test(url) };
}

export function fetchCds(link) {
  const { url, pdf } = downloadUrl(link);
  return execFileSync("uv", ["run", path.join(root, "scripts/research/fetch.py"), ...(pdf ? ["--pdf"] : []), url], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000, stdio: ["ignore", "pipe", "ignore"],
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const previous = (() => { try { return JSON.parse(readFileSync(OUT, "utf8")).colleges; } catch { return {}; } })();
  const colleges = { ...previous };
  const misses = [];
  for (const file of readdirSync(RESEARCH_DIR).filter((f) => f.endsWith(".json") && f !== "manifest.json").sort()) {
    const slug = file.replace(/\.json$/, "");
    if (only && !only.has(slug)) continue;
    const research = JSON.parse(readFileSync(path.join(RESEARCH_DIR, file), "utf8"));
    const url = cdsUrl(research) ?? EXTRA_LINKS[slug]?.url ?? null;
    if (!url) { misses.push(`${slug}: no CDS link`); continue; }
    try {
      const h6 = parseH6(fetchCds(url));
      if (!h6 || (!h6.needBased && !h6.meritBased && !h6.none && h6.awarded === null)) { misses.push(`${slug}: H6 not found`); continue; }
      const year = /20\d\d[-–_ ]?(?:20)?\d\d/.exec(decodeURIComponent(url))?.[0] ?? null;
      colleges[slug] = { ...h6, cdsYear: year, source: url };
      process.stderr.write(`${slug}: ${h6.needBased ? "need" : "-"} ${h6.meritBased ? "merit" : "-"} ${h6.none ? "none" : ""} awarded ${h6.awarded} avg ${h6.average}\n`);
    } catch (err) {
      misses.push(`${slug}: fetch failed (${String(err.message).slice(0, 80)})`);
    }
  }
  writeFileSync(OUT, `${JSON.stringify({ source: "Common Data Set section H6 (institutional aid to nonresident undergraduates)", generatedAt: new Date().toISOString().slice(0, 10), colleges }, null, 1)}\n`);
  process.stderr.write(`\n${Object.keys(colleges).length} colleges written; ${misses.length} misses:\n${misses.join("\n")}\n`);
}
