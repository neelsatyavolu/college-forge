export type Control = "public" | "private_nonprofit";
export type Credential = "bachelors" | "masters";
export type View = "overall" | "majors" | "beats";
/**
 * How much of the graduate price level earnings are divided by: "nominal" none (as reported),
 * "partial" half (the page default), "adjusted" all (full purchasing power).
 */
export type PriceMode = "nominal" | "partial" | "adjusted";

export type Weights = {
  early_premium: number;
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
  rank_partial: number;
  rank_partial_low: number;
  rank_partial_high: number;
  rank_adjusted: number;
  rank_adjusted_low: number;
  rank_adjusted_high: number;
};

export type School = Ranked & {
  unitid: number;
  institution: string;
  city: string | null;
  state: string;
  control: Control;
  score: number;
  score_partial: number;
  score_adjusted: number;
  early_premium_pct: number;
  early_premium_partial_pct: number;
  early_premium_adjusted_pct: number;
  later_premium_pct: number | null;
  later_premium_partial_pct: number | null;
  later_premium_adjusted_pct: number | null;
  graduation_rate: number;
  employment_rate: number | null;
  /** Six-year completion of first-year Pell recipients in the graduation cohort. Shown, not scored. */
  pell_graduation_rate: number | null;
  pell_cohort: number | null;
  typical_earnings: number | null;
  earnings_10yr: number | null;
  rpp_grad: number | null;
  location_observed: boolean;
  program_coverage: number;
  /** Share of scored bachelor's programs using 5-year (older class) earnings. */
  fallback_share: number | null;
  net_price: number | null;
  cost_of_attendance: number | null;
  pct_pell: number | null;
  beats_expectations: number | null;
  beats_rank: number | null;
  early_premium_pctile: number;
  early_premium_partial_pctile: number;
  early_premium_adjusted_pctile: number;
  graduation_pctile: number;
  employment_pctile: number | null;
};

export type OverallFile = RankingMeta & {
  n_ranked: number;
  n_eligible: number;
  schools: School[];
  fit?: BeatsFit;
};

export type MajorSummary = {
  credential: Credential;
  cip: string;
  name: string;
  family: string;
  n_ranked: number;
  national_median: number | null;
  graduates: number;
  /** Share of ranked programs using 5-year (older class) earnings. */
  fallback_share: number;
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
  premium_partial_pct: number;
  premium_adjusted_pct: number;
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
  overall_rank_partial: number | null;
  overall_rank_adjusted: number | null;
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

export type SensitivityRow = {
  variant: string;
  n_schools: number;
  spearman_vs_headline: number;
  top25_overlap: number;
  median_rank_shift: number;
};

type HeldOut = {
  within_major_rmse: number | null;
  dev_offset_rmse: number;
  rmse: number;
  rho: number | null;
  n: number;
  n_institutions: number;
  n_centered_programs: number;
  n_centered_majors: number;
  n_rho_programs: number;
  n_rho_majors: number;
};
type Coverage = { all: number; small: number; medium: number; large: number };
type HorizonLevel = { rmse: number; bias: number; rmse_small: number; coverage_90: number; coverage_90_small: number };
export type ValidationFile = {
  provenance: { generated_utc: string; code_commit: string; uncommitted_changes_in_ranking: boolean };
  noise: Record<Credential, { sigma: number; floor_sd: number; n_pairs: number }>;
  horizon_mapping: {
    shipped: string;
    test: Record<Credential, { n_programs: number; n_institutions: number; n_small: number; none: HorizonLevel; major: HorizonLevel; credential: HorizonLevel }>;
  };
  repeated_splits: Record<string, Record<Credential, { test_within_major_rmse: number; raw_within_major_rmse: number; test_rho: number; raw_rho: number; estimator: string; k: number }>>;
  chosen: Record<Credential, {
    estimator: string;
    k: number;
    test: HeldOut;
    test_raw_baseline: HeldOut;
    test_major_only_sd070: HeldOut;
    test_major_only_tuned: HeldOut & { k: number };
    test_minus_raw_within_major_rmse_90ci: [number, number];
    test_minus_tuned_major_only_within_major_rmse_90ci: [number, number];
    strata: Record<"target_under_50_earners" | "past_used_5yr_fallback", HeldOut | null>;
    strata_raw_baseline: Record<"target_under_50_earners" | "past_used_5yr_fallback", HeldOut | null>;
    coverage_90: { n: number; estimate_plus_target_noise: Coverage; with_floor: Coverage; published_width: Coverage };
    coverage_90_target_under_50: { n: number; estimate_plus_target_noise: Coverage; with_floor: Coverage; published_width: Coverage };
  }>;
};

export type BeatsFit = { out_of_fold_r2: number; residual_sd_points: number; n: number };

export type Filters = {
  q: string;
  state: string;
  control: "" | "public" | "private";
};
