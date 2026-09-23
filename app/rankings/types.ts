export type Control = "public" | "private_nonprofit";
export type Credential = "bachelors" | "masters";
export type View = "overall" | "majors" | "beats";

export type Weights = {
  early_premium: number;
  long_premium: number;
  graduation: number;
  employment: number;
};

export type RankingMeta = {
  generated: string;
  methodology_version: string;
  weights: Weights;
};

export type School = {
  rank: number;
  rank_low: number;
  rank_high: number;
  unitid: number;
  institution: string;
  city: string | null;
  state: string;
  control: Control;
  score: number;
  early_premium_pct: number;
  long_premium_pct: number | null;
  graduation_rate: number;
  employment_rate: number | null;
  typical_salary: number | null;
  salary_10yr: number | null;
  rpp_grad: number | null;
  rpp_source: string | null;
  coverage: number;
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

export type MajorIndexFile = RankingMeta & { majors: MajorSummary[] };

export type MajorRow = {
  rank: number;
  rank_low: number;
  rank_high: number;
  unitid: number;
  institution: string;
  city: string | null;
  state: string;
  control: Control;
  premium_pct: number;
  salary: number | null;
  salary_horizon: "1yr" | "4yr" | "5yr" | "";
  salary_adjusted: number | null;
  graduates: number;
  earners: number | null;
  overall_rank: number | null;
};

export type MajorFile = RankingMeta & {
  credential: Credential;
  cip: string;
  name: string;
  family: string;
  national_median: number | null;
  n_ranked: number;
  rows: MajorRow[];
};

/** unitid → [cip, rank, n_ranked][] for overall top-250 schools (bachelor's). */
export type SchoolMajorsFile = RankingMeta & {
  majors: Record<string, string>;
  ranks: Record<string, [string, number, number][]>;
};

export type Filters = {
  q: string;
  state: string;
  control: "" | "public" | "private";
};
