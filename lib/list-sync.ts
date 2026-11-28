/**
 * Keeps the college list (`ws.colleges`) and the applications (`ws.tracker.apps`) in step, so the List,
 * Shortlist, Essays, Portals and Progress tabs all show the same schools. Pure and safe to run twice.
 *
 * - Every application has a list school. One that has none gets a row with origin "user".
 * - Every list school the student kept (anything but an automatic seed suggestion) has an application.
 *   Seed suggestions get one only once the student keeps or stars them.
 * - Removing a school on one side removes it on the other only when its application is untouched
 *   (Not started, no saved login, notes or follow-ups). Otherwise the other side stays and is unlinked:
 *   the application is marked `offList`, or the list school's slug goes in `ws.noApplication`, so this
 *   sync doesn't add it back. Essay drafts are never deleted.
 */
import type { College, Workspace } from "./store";
import { matchCatalog, matchCatalogExact, newApp, relink, type TrackedApp } from "./tracker";
import { collegeByWebsite } from "./catalog";
import { slugify, usNewsToCollege } from "./colleges";
import { US_NEWS_BY_SLUG, US_NEWS_TOP_250, type UsNewsCollege } from "./us-news-rankings";
import { isSeededRow } from "./seed-rows";
import { syncRounds } from "./round-sync";

/** An application nobody has worked on yet, so removing it loses nothing. */
export function isUntouchedApp(app: TrackedApp): boolean {
  return app.status === "planning" && !app.login && !(app.notes || "").trim() && !(app.followUps?.length);
}

/**
 * Pairs applications with list schools, one to one: first by saved slug, then by name, then by catalog
 * school, so an exact match always wins over a looser one. Returns app id → college slug.
 */
export function linksOf(ws: Pick<Workspace, "colleges" | "tracker">): Map<string, string> {
  const links = new Map<string, string>();
  const claimed = new Set<string>();
  const colleges = ws.colleges.filter((c) => c.slug);
  const catalogIds = new Map(colleges.map((c) => [c.slug, (collegeByWebsite(c.url) ?? (c.name ? matchCatalogExact(c.name) : undefined))?.id] as const));
  const passes: ((app: TrackedApp, c: College) => boolean)[] = [
    (app, c) => !!app.slug && app.slug === c.slug,
    (app, c) => {
      const name = slugify(app.name);
      return !!name && (name === slugify(c.name || "") || name === c.slug);
    },
    (app, c) => !!app.collegeId && app.collegeId === catalogIds.get(c.slug),
  ];
  for (const same of passes) {
    for (const app of ws.tracker.apps) {
      if (links.has(app.id)) continue;
      // An application taken off the list comes back only when the student adds the school again, not with a suggestion.
      const hit = colleges.find((c) => !claimed.has(c.slug) && !(app.offList && isSeededRow(c)) && same(app, c));
      if (!hit) continue;
      links.set(app.id, hit.slug);
      claimed.add(hit.slug);
    }
  }
  return links;
}

let usNewsByCatalog: Map<string, UsNewsCollege> | null = null;
/** U.S. News entries by catalog id. Ranked first wins, so "University of Michigan" is Ann Arbor, not Dearborn. */
function usNewsForCatalog(id: string): UsNewsCollege | undefined {
  if (!usNewsByCatalog) {
    usNewsByCatalog = new Map();
    for (const u of US_NEWS_TOP_250) {
      const hit = matchCatalog(u.name);
      if (hit && !usNewsByCatalog.has(hit.id)) usNewsByCatalog.set(hit.id, u);
    }
  }
  return usNewsByCatalog.get(id);
}

/** A list row for an application that has none: U.S. News facts when the school is known, else just its name. */
export function collegeFromApp(app: TrackedApp, taken: Set<string>): College {
  const u = (app.slug ? US_NEWS_BY_SLUG.get(app.slug) : undefined)
    ?? US_NEWS_BY_SLUG.get(slugify(app.name))
    ?? (app.collegeId ? usNewsForCatalog(app.collegeId) : undefined);
  const base: College = u ? usNewsToCollege(u) : { slug: slugify(app.name), name: app.name, short: app.name };
  // An earlier slug keeps the school's essay group and drafts attached.
  let slug = app.slug || base.slug || "school";
  for (let n = 2; taken.has(slug); n++) slug = `${app.slug || base.slug || "school"}-${n}`;
  return { ...base, slug, origin: "user" };
}

/**
 * The add-only half: links what matches, gives each application a list row and each kept list school an
 * application. Returns the same object when nothing changed.
 */
export function linkListAndApplications(ws: Workspace): Workspace {
  const links = linksOf(ws);
  const noApplication = new Set(ws.noApplication ?? []);
  let changed = false;
  const linkedSlugs = new Set(links.values());
  const bySlug = new Map(ws.colleges.map((c) => [c.slug, c] as const));
  const taken = new Set(ws.colleges.map((c) => c.slug));
  const promoted = new Set<string>();
  const added: College[] = [];

  const apps = ws.tracker.apps.map((app) => {
    const slug = links.get(app.id);
    if (slug) {
      noApplication.delete(slug);
      // An application makes the school the student's, so a rebalance never drops it.
      if (isSeededRow(bySlug.get(slug)!)) promoted.add(slug);
      // A school whose name the catalog doesn't know ("Fresno State" saved as written) is found by its list row's website.
      const linked = relink(app, bySlug.get(slug)!.url);
      if (linked === app && app.slug === slug && !app.offList) return app;
      changed = true;
      const { offList: _o, ...rest } = linked;
      return { ...rest, slug };
    }
    if (app.offList) return app;
    const row = collegeFromApp(app, taken);
    taken.add(row.slug);
    added.push(row);
    changed = true;
    return { ...app, slug: row.slug };
  });

  const created: TrackedApp[] = [];
  const catalogIds = new Set(apps.map((a) => a.collegeId).filter(Boolean));
  for (const c of ws.colleges) {
    if (!c.slug || linkedSlugs.has(c.slug) || noApplication.has(c.slug) || isSeededRow(c)) continue;
    linkedSlugs.add(c.slug);
    const app = newApp({ name: c.name || c.short || c.slug, slug: c.slug, website: c.url });
    // Two list schools on one catalog entry (Ann Arbor and Dearborn): the second keeps its own name.
    const named = app.collegeId && catalogIds.has(app.collegeId) ? { ...app, name: (c.name || app.name).slice(0, 120) } : app;
    if (named.collegeId) catalogIds.add(named.collegeId);
    created.push(named);
    changed = true;
  }

  const noAppChanged = (ws.noApplication ?? []).length !== noApplication.size;
  if (!changed && !promoted.size && !noAppChanged) return ws;
  const colleges = [
    ...ws.colleges.map((c) => (promoted.has(c.slug) ? { ...c, origin: "user" as const } : c)),
    ...added,
  ];
  return {
    ...withNoApplication(ws, noApplication),
    colleges,
    tracker: { ...ws.tracker, apps: [...apps, ...created] },
  };
}

function withNoApplication(ws: Workspace, slugs: Set<string>): Workspace {
  const { noApplication: _old, ...rest } = ws;
  return slugs.size ? { ...rest, noApplication: [...slugs] } : rest;
}

/**
 * The removal half, from what a mutation removed: a school taken off the list takes its untouched
 * application with it, and an untouched application taken away takes its list school. Anything with
 * work in it stays and is unlinked instead.
 */
export function cascadeRemovals(before: Workspace, after: Workspace): Workspace {
  const afterSlugs = new Set(after.colleges.map((c) => c.slug));
  const afterApps = new Map(after.tracker.apps.map((a) => [a.id, a] as const));
  const dropApps = new Set<string>();
  const offList = new Set<string>();
  const dropSlugs = new Set<string>();
  const noApplication = new Set((after.noApplication ?? []).filter((s) => afterSlugs.has(s)));

  const beforeSlugs = new Set(before.colleges.map((c) => c.slug));
  const addedColleges = after.colleges.filter((c) => !beforeSlugs.has(c.slug));
  const relink = new Set<string>();
  for (const [appId, slug] of linksOf(before)) {
    const app = afterApps.get(appId);
    const collegeGone = !afterSlugs.has(slug);
    if (collegeGone && app && addedColleges.length && linksOf({ colleges: addedColleges, tracker: { ...after.tracker, apps: [{ ...app, slug: undefined }] } }).size) {
      relink.add(appId);
    } else if (collegeGone && app) {
      if (isUntouchedApp(app)) dropApps.add(appId);
      else offList.add(appId);
    } else if (!app && !collegeGone) {
      const old = before.tracker.apps.find((a) => a.id === appId)!;
      if (isUntouchedApp(old)) dropSlugs.add(slug);
      else noApplication.add(slug);
    }
  }
  const noAppChanged = noApplication.size !== (after.noApplication ?? []).length;
  if (!dropApps.size && !offList.size && !dropSlugs.size && !relink.size && !noAppChanged) return after;

  const apps = after.tracker.apps
    .filter((a) => !dropApps.has(a.id))
    .map((a) => {
      if (relink.has(a.id)) {
        // The link step pairs it with the renamed row.
        const { slug: _s, ...rest } = a;
        return rest;
      }
      if (!offList.has(a.id)) return a;
      const { slug: _s, ...rest } = a;
      return { ...rest, offList: true as const };
    });
  for (const slug of dropSlugs) noApplication.delete(slug);
  return {
    ...withNoApplication(after, noApplication),
    colleges: after.colleges.filter((c) => !dropSlugs.has(c.slug)),
    tracker: { ...after.tracker, apps },
  };
}

/** Both halves, for a write: what `mutated` removed relative to `before`, then the links and backfill, then one round per school (lib/round-sync.ts). */
export function syncListAndApplications(before: Workspace | null, mutated: Workspace): Workspace {
  const linked = linkListAndApplications(before ? cascadeRemovals(before, mutated) : mutated);
  return before ? syncRounds(before, linked) : linked;
}
