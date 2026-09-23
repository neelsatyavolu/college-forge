"""Pinned paths and constants for the Forge Career Outcomes Ranking (methodology v2.0)."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
OUT = ROOT / "out"

METHODOLOGY_VERSION = "2.0"

# Access / release pins (recorded in sources.md at run time)
SCORECARD_RELEASE = "Most-Recent-Cohorts_06102026"
PSEO_RELEASE = "R2025Q4 / latest_release 2025Q4"
BEA_RPP_YEARS = "2008-2024"
RPP_YEAR = "2024"  # most recent BEA RPP column
REFERENCE_YEAR = 2024  # deflate nominal earnings to this year via PCE
EARNINGS_DOLLAR_YEAR = 2022  # Scorecard earnings ≈ 2021–2022 dollars; pinned for transparency

# Overall-ranking universe (§2)
UGDS_MIN = 500
PREDDEG_BACHELORS = 3
CONTROL_ALLOWED = {1, 2}  # public, private nonprofit
# Share of a school's bachelor's completions that must sit in programs with published earnings
COVERAGE_FLOOR = 0.30

# Overall score weights (§4). Fixed a priori; never tuned to make results look familiar.
OVERALL_WEIGHTS = {
    "early_premium": 0.40,  # early-career earnings vs same major nationally, cost-of-living adjusted
    "long_premium": 0.20,   # 10-yr-after-entry earnings vs major-mix expectation, cost-of-living adjusted
    "graduation": 0.25,     # six-year completion rate
    "employment": 0.15,     # working share among graduates not enrolled, 3 yrs after completion
}
# Overall ranking is for students starting college: schools without first-time-student
# graduation data (health-science centers, upper-division, graduate schools) appear only in per-major tables.
REQUIRED_COMPONENTS = ("early_premium", "graduation")
Z_CLIP = 3.0

# Program model (programs.py)
LOG_EARNINGS_SD = 0.70  # within-program SD of log earnings, early career
HORIZON_SE_INFLATION = 2.0  # 1-year earnings count half as much as 4/5-year
MIN_PROGRAM_VARIANCE = 0.002

# Per-major rankings (§5)
MAJOR_MIN_SCHOOLS = 20
MAJOR_TOP_N = 250
OVERALL_TOP_N = 250

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
