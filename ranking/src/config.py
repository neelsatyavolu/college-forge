"""Pinned paths and constants for the Forge Career Outcomes Ranking (methodology v3.2)."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
OUT = ROOT / "out"

METHODOLOGY_VERSION = "3.2"

# Access / release pins (recorded in sources.md at run time)
SCORECARD_RELEASE = "Most-Recent-Cohorts_06102026"
PSEO_RELEASE = "R2025Q4 / latest_release 2025Q4"
BEA_RPP_YEARS = "2008-2024"
RPP_YEAR = "2024"  # most recent BEA RPP column
REFERENCE_YEAR = 2024  # every dollar figure is restated in this year's dollars via PCE
# Source dollar year per field for SCORECARD_RELEASE, from the Scorecard data dictionary
# (FieldOfStudy_Cohort_Map / Most_Recent_Inst_Cohort_Map). Re-check on every release.
FIELD_DOLLAR_YEAR = {
    "EARN_MDN_1YR": 2022,       # AY2018-19, AY2019-20 completers, measured CY2020-21
    "EARN_MDN_4YR": 2024,       # AY2017-18, AY2018-19 completers, measured CY2022-23
    "EARN_MDN_4YR_NAT": 2024,
    "EARN_MDN_5YR": 2022,       # AY2014-15, AY2015-16 completers, measured CY2020-21
    "MD_EARN_WNE_P10": 2022,    # AY2009-10, AY2010-11 entrants, measured CY2020-21
}
EARNINGS_COHORTS = {
    "1yr": "2018–20 graduates, earnings in 2020–21",
    "4yr": "2017–19 graduates, earnings in 2022–23",
    "5yr": "2014–16 graduates, earnings in 2020–21",
    "10yr_entry": "students who started in 2009–11, earnings in 2020–21",
}

# Overall-ranking universe (§2)
UGDS_MIN = 500
PREDDEG_BACHELORS = 3
CONTROL_ALLOWED = {1, 2}  # public, private nonprofit
# Share of a school's bachelor's completions that must sit in programs with published earnings
COVERAGE_FLOOR = 0.30

# Overall score weights (§6). Value judgments fixed a priori; never tuned to make results
# look familiar. v3.0 removed the 10-years-after-entry earnings component (it compared
# entrants incl. non-completers against a completer baseline) and renormalized the rest
# proportionally from the original 40/25/15.
OVERALL_WEIGHTS = {
    "early_premium": 0.50,   # early-career earnings vs same major nationally
    "graduation": 0.3125,    # six-year completion rate
    "employment": 0.1875,    # working share among graduates not enrolled, 3 yrs after completion
}
# Overall ranking is for students starting college: schools without first-time-student
# graduation data (health-science centers, upper-division, graduate schools) appear only in per-major tables.
REQUIRED_COMPONENTS = ("early_premium", "graduation")
Z_CLIP = 3.0

# Program model (programs.py). Calibrated and selected by the out-of-sample backtest
# (src/backtest.py → out/backtest.json); tests/test_backtest_pins.py checks these pins.
# σ: effective count-dependent error scale of a program's log median earnings, calibrated on
#    development institutions from how much the same programs moved between graduating
#    classes with no overlapping completion years (AY2014-16 → AY2017-19). Replaces 0.70.
LOG_EARNINGS_SD = {"bachelors": 0.454, "masters": 0.383}
# floor: count-independent change between classes (does not shrink with program size);
#    added to program uncertainty so large programs' intervals are not overconfident.
PROGRAM_FLOOR_SD = {"bachelors": 0.019, "masters": 0.048}
# k: multiplier on sampling variance used for shrinkage, chosen from a fixed grid by
#    within-major next-class prediction error on development institutions.
SHRINK_K = {"bachelors": 1.5, "masters": 2.0}
# 5-year → 4-year mapping for programs whose 4-year earnings are withheld (v3.1): each
#    major's mean y5 − y4 among programs publishing both, shrunk toward the credential mean.
#    Level chosen on development institutions and checked on held-out ones (backtest.horizon_test).
HORIZON_SHIFT_LEVEL = "major"
MIN_PROGRAM_VARIANCE = 0.002

# Per-major rankings (§5)
MAJOR_MIN_SCHOOLS = 20
MAJOR_TOP_N = 250
OVERALL_TOP_N = 250

# Cost of living (§4). The page default subtracts this share of ln(graduate price level):
# 0 = earnings as reported, 1 = full purchasing power. 0.5 gives equal weight to what the
# degree earns in the job market (which travels with the graduate) and what that pay buys
# where graduates live. A value judgment like the component weights, not an estimate;
# as-reported and full adjustment are published alongside it.
COST_OF_LIVING_WEIGHT = 0.5

# Geography
RADIUS_MI_DEFAULT = 40.0
# Extra shelter weight on top of BEA all-items (young renters spend more on housing
# than the all-items basket). 0.10 ≈ +10pp shelter share.
HOUSING_EXTRA_WEIGHT = 0.10
RPP_LINE_ALL = 1.0
RPP_LINE_HOUSING = 3.0

# Uncertainty
N_BOOT = 500
RANDOM_SEED = 42

INST_CSV = RAW / "institution" / "Most-Recent-Cohorts-Institution.csv"
FOS_CSV = RAW / "fos" / "Most-Recent-Cohorts-Field-of-Study.csv"
MARPP_CSV = RAW / "marpp" / "MARPP_MSA_2008_2024.csv"
SARPP_CSV = RAW / "sarpp" / "SARPP_STATE_2008_2024.csv"
PCE_CSV = RAW / "PCEPI.csv"
COUNTY_CENTROIDS = RAW / "CenPop2020_Mean_CO.txt"
COUNTY_POP = RAW / "co-est2023-alldata.csv"
CBSA_XLSX = RAW / "cbsa_delineation.xlsx"
PSEO_FLOWS = RAW / "pseo" / "pseof_all.csv.gz"
PSEO_INST = RAW / "pseo" / "pseo_all_institutions.csv"
PSEO_DEST_CACHE = PROCESSED / "pseo_dest_div.csv"
PUBLIC_RANKINGS = ROOT.parent / "public" / "data" / "rankings"
