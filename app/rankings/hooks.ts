import { useCallback, useEffect, useState } from "react";

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

/** A value kept in this browser only (localStorage), never sent to the server. */
export function useStored<T>(key: string, initial: T, valid: (v: unknown) => v is T): [T, (v: T) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [stored, setStored] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      const v: unknown = raw == null ? null : JSON.parse(raw);
      if (valid(v)) { setValue(v); setStored(true); }
    } catch {
      /* storage unavailable or corrupt: keep the default */
    }
  }, [key, valid]);
  const set = useCallback((v: T) => {
    setValue(v);
    setStored(true);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* storage unavailable: the choice still applies for this visit */
    }
  }, [key]);
  return [value, set, stored];
}
