export type Control = "public" | "private_nonprofit";
export type Credential = "bachelors" | "masters";
export type View = "overall" | "majors" | "beats";
/** Whether earnings are adjusted for the cost of living where graduates work. */
export type PriceMode = "adjusted" | "nominal";

export type Weights = {
  early_premium: number;
  long_premium: number;
  graduation: number;
  employment: number;
};

export type Cohorts = { "1yr": string; "4yr": string; "5yr": string; "10yr_entry": string };

type BaseMeta = {
  generated: string;
  methodology_version: string;
  dollar_year: number;
  cohorts: Cohorts;
};

export type RankingMeta = BaseMeta & { weights: Weights };
export type MajorMeta = BaseMeta & { scoring: string };

type Ranked = {
  rank: number;
  rank_low: number;
  rank_high: number;
  rank_nominal: number;
  rank_nominal_low: number;
  rank_nominal_high: number;
};

export type School = Ranked & {
  unitid: number;
  institution: string;
  city: string | null;
  state: string;
  control: Control;
  score: number;
  score_nominal: number;
  early_premium_pct: number;
  early_premium_nominal_pct: number;
  long_premium_pct: number | null;
  long_premium_nominal_pct: number | null;
  graduation_rate: number;
  employment_rate: number | null;
  typical_earnings: number | null;
  earnings_10yr: number | null;
  rpp_grad: number | null;
  location_observed: boolean;
  program_coverage: number;
  net_price: number | null;
  cost_of_attendance: number | null;
  pct_pell: number | null;
  beats_expectations: number | null;
  beats_rank: number | null;
  early_premium_pctile: number;
  long_premium_pctile: number | null;
  graduation_pctile: number;
  employment_pctile: number | null;
};

export type OverallFile = RankingMeta & {
  n_ranked: number;
  n_eligible: number;
  schools: School[];
};

export type MajorSummary = {
  credential: Credential;
  cip: string;
  name: string;
  family: string;
  n_ranked: number;
  national_median: number | null;
  graduates: number;
};

export type MajorIndexFile = MajorMeta & { majors: MajorSummary[] };

export type Horizon = "1yr" | "4yr" | "5yr" | "";

export type MajorRow = Ranked & {
  unitid: number;
  institution: string;
  city: string | null;
  state: string;
  control: Control;
  premium_pct: number;
  premium_nominal_pct: number;
  earnings: number | null;
  earnings_horizon: Horizon;
  earnings_count: number | null;
  earnings_adjusted: number | null;
  earners_1yr: number | null;
  earners_4yr: number | null;
  earners_5yr: number | null;
  completions: number | null;
  location_observed: boolean;
  overall_rank: number | null;
};

export type MajorFile = MajorMeta & {
  credential: Credential;
  cip: string;
  name: string;
  family: string;
  national_median: number | null;
  n_ranked: number;
  rows: MajorRow[];
};

/** unitid → [cip, rank, n_ranked][] for overall top-250 schools (bachelor's). */
export type SchoolMajorsFile = MajorMeta & {
  majors: Record<string, string>;
  ranks: Record<string, [string, number, number][]>;
};

export type SensitivityRow = { variant: string; spearman_vs_headline: number; top25_overlap: number };

export type Filters = {
  q: string;
  state: string;
  control: "" | "public" | "private";
};
