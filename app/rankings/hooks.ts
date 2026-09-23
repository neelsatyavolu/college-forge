import { useCallback, useEffect, useState } from "react";
import type { Credential, Filters, PriceMode, View } from "./types";

const cache = new Map<string, Promise<unknown>>();

function loadJson<T>(url: string): Promise<T> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => {
      const type = r.headers.get("content-type") || "";
      if (!r.ok || !type.includes("json")) {
        throw new Error(`Couldn’t load ranking data (${r.status}). Try refreshing the page.`);
      }
      return r.json();
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p as Promise<T>;
}

export type Loadable<T> = { data: T | null; error: string | null; loading: boolean };

/** Fetch JSON once per URL; pass null to skip. */
export function useJson<T>(url: string | null): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ data: null, error: null, loading: !!url });
  useEffect(() => {
    if (!url) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let live = true;
    setState((s) => ({ data: s.data, error: null, loading: true }));
    loadJson<T>(url)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((e: unknown) =>
        live && setState({ data: null, error: e instanceof Error ? e.message : "Couldn’t load ranking data.", loading: false })
      );
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

export function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState("light");
  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") || "light");
  }, []);
  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("cf.theme", next);
      } catch {
        /* storage unavailable: theme still applies for this visit */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}

export type RankingsQuery = Filters & { view: View; credential: Credential; major: string; prices: PriceMode };

const DEFAULTS: RankingsQuery = { view: "overall", credential: "bachelors", major: "", q: "", state: "", control: "", prices: "partial" };
const VIEWS: View[] = ["overall", "majors", "beats"];

/** ?prices=none|full (older links: nominal|adjusted); anything else is the half-adjusted default. */
function readPrices(v: string | null): PriceMode {
  if (v === "none" || v === "nominal") return "nominal";
  if (v === "full" || v === "adjusted") return "adjusted";
  return "partial";
}

function readQuery(): RankingsQuery {
  if (typeof window === "undefined") return DEFAULTS;
  const p = new URLSearchParams(window.location.search);
  const view = p.get("view") as View;
  const control = p.get("control");
  return {
    view: VIEWS.includes(view) ? view : "overall",
    credential: p.get("level") === "masters" ? "masters" : "bachelors",
    major: (p.get("major") || "").replace(/\D/g, "").slice(0, 4),
    q: p.get("q") || "",
    state: (p.get("state") || "").toUpperCase().slice(0, 2),
    control: control === "public" || control === "private" ? control : "",
    prices: readPrices(p.get("prices")),
  };
}

/** Query-string-backed view state, so every table is linkable. */
export function useRankingsQuery(): [RankingsQuery, (patch: Partial<RankingsQuery>) => void] {
  const [query, setQuery] = useState<RankingsQuery>(DEFAULTS);
  useEffect(() => {
    setQuery(readQuery());
    const onPop = () => setQuery(readQuery());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const update = useCallback((patch: Partial<RankingsQuery>) => {
    setQuery((prev) => {
      const next = { ...prev, ...patch };
      const p = new URLSearchParams();
      if (next.view !== "overall") p.set("view", next.view);
      if (next.view === "majors") {
        if (next.credential === "masters") p.set("level", "masters");
        if (next.major) p.set("major", next.major);
      }
      if (next.q) p.set("q", next.q);
      if (next.state) p.set("state", next.state);
      if (next.control) p.set("control", next.control);
      if (next.prices !== "partial" && next.view !== "beats") p.set("prices", next.prices === "nominal" ? "none" : "full");
      const s = p.toString();
      window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
      return next;
    });
  }, []);
  return [query, update];
}
