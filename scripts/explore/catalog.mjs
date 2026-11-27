/**
 * Pure helpers for scripts/explore/build-catalog.mjs: turn College Scorecard rows, U.S. News ranks
 * and Wikimedia Commons photo metadata into the compact rows of public/data/explore-colleges.json.
 * No network here, so tests can run every rule.
 */

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const sum2 = (a, b) => (num(a) !== null && num(b) !== null ? a + b : null);

/** Scorecard `school.locale` → campus setting. */
export function localeToSetting(locale) {
  if (typeof locale !== "number") return null;
  if (locale >= 11 && locale <= 13) return "urban";
  if (locale >= 21 && locale <= 23) return "suburban";
  if (locale >= 31 && locale <= 33) return "town";
  if (locale >= 41 && locale <= 43) return "rural";
  return null;
}

/** Carnegie basic classification → a short kind: research university, liberal arts college, etc. */
export function kindOf(carnegie) {
  if (carnegie === 15 || carnegie === 16 || carnegie === 17) return "research";
  if (carnegie >= 18 && carnegie <= 20) return "masters";
  if (carnegie === 21) return "liberal-arts";
  if (carnegie === 22 || carnegie === 23) return "baccalaureate";
  if (carnegie >= 24 && carnegie <= 32) return "special";
  return null;
}

/** Scorecard region id → the region filter's buckets. */
export const REGION = {
  1: "northeast", 2: "northeast", 3: "midwest", 4: "midwest",
  5: "south", 6: "south", 7: "west", 8: "west", 9: "other",
};

export const SCORECARD_FIELDS = [
  "id",
  "school.name",
  "school.alias",
  "school.city",
  "school.state",
  "school.region_id",
  "school.school_url",
  "school.ownership",
  "school.locale",
  "school.carnegie_basic",
  "school.religious_affiliation",
  "school.women_only",
  "school.men_only",
  "school.minority_serving.historically_black",
  "latest.student.size",
  "latest.admissions.admission_rate.overall",
  "latest.admissions.test_requirements",
  "latest.admissions.sat_scores.25th_percentile.critical_reading",
  "latest.admissions.sat_scores.25th_percentile.math",
  "latest.admissions.sat_scores.75th_percentile.critical_reading",
  "latest.admissions.sat_scores.75th_percentile.math",
  "latest.admissions.act_scores.25th_percentile.cumulative",
  "latest.admissions.act_scores.75th_percentile.cumulative",
  "latest.cost.avg_net_price.overall",
  "latest.cost.attendance.academic_year",
  "latest.cost.tuition.in_state",
  "latest.cost.tuition.out_of_state",
  "latest.completion.completion_rate_4yr_150nt",
  "latest.earnings.10_yrs_after_entry.median",
  "latest.aid.pell_grant_rate",
];

/** One Scorecard API result → a catalog row (without photo or rank). Nulls are dropped. */
export function scorecardRow(r) {
  const row = {
    id: num(r.id),
    name: String(r["school.name"] || "").trim(),
    alias: r["school.alias"] || null,
    city: r["school.city"] || null,
    state: r["school.state"] || null,
    region: REGION[r["school.region_id"]] ?? null,
    url: r["school.school_url"] || null,
    control: r["school.ownership"] === 1 ? "public" : r["school.ownership"] === 2 ? "private" : null,
    setting: localeToSetting(r["school.locale"]),
    kind: kindOf(r["school.carnegie_basic"]),
    religious: num(r["school.religious_affiliation"]) !== null && r["school.religious_affiliation"] > 0 ? true : null,
    women: r["school.women_only"] === 1 ? true : null,
    men: r["school.men_only"] === 1 ? true : null,
    hbcu: r["school.minority_serving.historically_black"] === 1 ? true : null,
    size: num(r["latest.student.size"]),
    admit: num(r["latest.admissions.admission_rate.overall"]),
    testReq: num(r["latest.admissions.test_requirements"]),
    sat25: sum2(r["latest.admissions.sat_scores.25th_percentile.critical_reading"], r["latest.admissions.sat_scores.25th_percentile.math"]),
    sat75: sum2(r["latest.admissions.sat_scores.75th_percentile.critical_reading"], r["latest.admissions.sat_scores.75th_percentile.math"]),
    act25: num(r["latest.admissions.act_scores.25th_percentile.cumulative"]),
    act75: num(r["latest.admissions.act_scores.75th_percentile.cumulative"]),
    net: num(r["latest.cost.avg_net_price.overall"]),
    coa: num(r["latest.cost.attendance.academic_year"]),
    tuitionIn: num(r["latest.cost.tuition.in_state"]),
    tuitionOut: num(r["latest.cost.tuition.out_of_state"]),
    grad: num(r["latest.completion.completion_rate_4yr_150nt"]),
    earn: num(r["latest.earnings.10_yrs_after_entry.median"]),
    pell: num(r["latest.aid.pell_grant_rate"]),
  };
  return dropNulls(row);
}

export function dropNulls(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ""));
}

/** A Commons file title from a Wikidata P18 value (a Special:FilePath URL). */
export function commonsTitle(p18) {
  const m = String(p18).match(/Special:FilePath\/(.+)$/);
  return m ? `File:${decodeURIComponent(m[1])}` : null;
}

const stripHtml = (s) =>
  String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Licenses Forge can show with attribution. Anything else (fair use, unknown) is skipped. */
const FREE_LICENSE = /^(cc0|cc[ -]by(-sa)?( \d(\.\d)?)?|public domain|pd|gfdl)/i;

/** File names of old drawings, postcards and photos of people rather than of the campus. */
const NOT_CAMPUS = /(postcard|engraving|lithograph|drawing|painting|watercolou?r|sketch|illustration|circa|\bca\.|\b1[6-8]\d\d\b|\b19[0-5]\d\b|students|graduat|commencement|president|portrait|headshot|team|players|cheerleader|band\b|mascot|ceremony|visit|meeting|speech|signing)/i;

/** Commons imageinfo → a usable photo, or null when it is too small, portrait, or not freely licensed. */
export function commonsPhoto(info, pageUrl) {
  if (!info || !info.thumburl) return null;
  const w = num(info.width);
  const h = num(info.height);
  if (!w || !h || w < 900 || w / h < 1.15 || w / h > 3.2) return null;
  const meta = info.extmetadata || {};
  if (NOT_CAMPUS.test(decodeURIComponent(String(pageUrl || "")))) return null;
  const taken = String(stripHtml(meta.DateTimeOriginal?.value)).match(/\b(1[6-9]\d\d|20\d\d)\b/);
  if (taken && Number(taken[1]) < 1960) return null;
  const license = stripHtml(meta.LicenseShortName?.value);
  if (!FREE_LICENSE.test(license)) return null;
  if (!/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(info.thumburl)) return null;
  const by = stripHtml(meta.Artist?.value).slice(0, 80) || "Wikimedia Commons contributor";
  return { src: info.thumburl.replace(/\?.*$/, ""), credit: { by, license: license.slice(0, 40), page: pageUrl } };
}

/** A smaller standard-width Commons thumbnail of the same file, for cards. */
export function commonsThumb(src, width) {
  return String(src).replace(/\/(\d+)px-([^/]+)$/, `/${width}px-$2`);
}

/**
 * The photo a row shows: a large, freely licensed Commons photo (credited, and the same quality
 * bar for every school); then Forge's curated local photo; then the small U.S. News thumbnail.
 */
export function pickPhoto({ usnewsPhoto, localSize, commons }) {
  const local = usnewsPhoto && usnewsPhoto.startsWith("/") ? usnewsPhoto : null;
  if (commons) return { photo: commons.src, thumb: commonsThumb(commons.src, 500), credit: commons.credit };
  if (local && isGoodSize(localSize)) return { photo: local };
  if (local) return { photo: local };
  if (usnewsPhoto && /^https:\/\/www\.usnews\.com\//.test(usnewsPhoto)) return { photo: usnewsPhoto };
  return {};
}

/** Wide enough for the Explore hero and landscape enough for a card crop. */
export function isGoodSize(size) {
  return Boolean(size && size.width >= 1000 && size.width / size.height >= 1.15);
}

/** Width and height of a JPEG or PNG from its bytes, or null. */
export function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  for (let i = 2; i + 9 < buf.length; ) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/** Give every row a unique slug: ranked rows keep their U.S. News slug; later twins get "-<state>". */
export function assignSlugs(rows) {
  const used = new Set();
  return rows.map((r) => {
    let slug = r.slug || slugify(r.name);
    if (used.has(slug) && r.state) slug = `${slug}-${r.state.toLowerCase()}`;
    if (used.has(slug)) slug = `${slug}-${r.id}`;
    used.add(slug);
    return { ...r, slug };
  });
}

/** Files in a Wikipedia article that are probably not campus photos. */
const NOT_A_PHOTO = /(seal|logo|wordmark|crest|coat[_ ]of[_ ]arms|emblem|map|locator|flag|signature|icon|athletic|mascot|diagram|chart|\.svg$|\.gif$|\.tiff?$|\.pdf$|\.webm$|\.ogg$)/i;

/** Article image file names worth checking as campus photos, in article order. */
export function articlePhotoCandidates(files, max = 6) {
  return files.filter((f) => !NOT_A_PHOTO.test(f)).slice(0, max).map((f) => `File:${f.replace(/_/g, " ")}`);
}
