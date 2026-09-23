import type { Control, Credential, Filters, PriceMode } from "./types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function money(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? "—" : usd.format(n);
}

export function moneyShort(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`;
}

/** +42% / −8%, using a real minus sign. */
export function signedPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const r = Math.round(n);
  if (r === 0) return "±0%";
  return r > 0 ? `+${r}%` : `−${Math.abs(r)}%`;
}

export function signedPoints(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const r = n.toFixed(1);
  return n > 0 ? `+${r}` : n < 0 ? `−${r.slice(1)}` : r;
}

export function rate(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? "—" : `${Math.round(n * 100)}%`;
}

export function controlLabel(c: Control): string {
  return c === "public" ? "Public" : "Private";
}

export function credentialLabel(c: Credential): string {
  return c === "bachelors" ? "Bachelor’s" : "Master’s";
}

export function horizonLabel(h: string): string {
  return h === "1yr" ? "1 yr after graduating" : h === "5yr" ? "5 yrs after graduating" : h === "4yr" ? "4 yrs after graduating" : "";
}

type RankFields = {
  rank: number; rank_low: number; rank_high: number;
  rank_adjusted: number; rank_adjusted_low: number; rank_adjusted_high: number;
};

/** Rank and 5th–95th percentile range for the active ordering (after cost of living by default). */
export function rankFor(row: RankFields, mode: PriceMode): { rank: number; low: number; high: number } {
  return mode === "adjusted"
    ? { rank: row.rank_adjusted, low: row.rank_adjusted_low, high: row.rank_adjusted_high }
    : { rank: row.rank, low: row.rank_low, high: row.rank_high };
}

export function ordinalPct(p: number | null | undefined): string {
  return p == null ? "—" : `Better than ${Math.max(0, Math.round(p) - 1)}% of ranked colleges`;
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

type Filterable = { institution: string; city: string | null; state: string; control: Control };

export function matchesFilters(row: Filterable, f: Filters): boolean {
  if (f.state && row.state !== f.state) return false;
  if (f.control === "public" && row.control !== "public") return false;
  if (f.control === "private" && row.control !== "private_nonprofit") return false;
  const q = f.q.trim().toLowerCase();
  if (!q) return true;
  return `${row.institution} ${row.city ?? ""} ${row.state}`.toLowerCase().includes(q);
}
