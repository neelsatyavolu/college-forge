"""Pinned paths and constants for the Purchasing-Power College Ranking."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
OUT = ROOT / "out"

# Access / release pins (recorded in sources.md at run time)
SCORECARD_RELEASE = "Most-Recent-Cohorts_06102026"
PSEO_RELEASE = "R2025Q4 / latest_release 2025Q4"
BEA_RPP_YEARS = "2008-2024"
RPP_YEAR = "2024"  # most recent BEA RPP column
REFERENCE_YEAR = 2024  # deflate nominal earnings to this year via PCE
EARNINGS_VINTAGE_NOTE = "Scorecard FoS EARN_MDN_4YR (4 years after completion); MD_EARN_WNE_P10 is 10yr-after-entry, reported only"

# Eligibility (§2)
UGDS_MIN = 500
PREDDEG_BACHELORS = 3
CONTROL_ALLOWED = {1, 2}  # public, private nonprofit
COHORT_FLOOR = 50  # bachelor's completions per CIP
COVERAGE_FOS = 0.50
COVERAGE_INST_FLOOR = 0.30

# Reputation (§5)
REP_WEIGHTS = {"yield": 0.40, "research": 0.40, "outcomes": 0.20}
COMPOSITE_VALUE_W = 0.70
COMPOSITE_REP_W = 0.30
REP_RESIDUALIZE_THRESHOLD = 0.50  # Pearson r

# Geography
RADIUS_MI_DEFAULT = 40.0
RADIUS_MI_SENS = (25.0, 40.0, 50.0)
# Extra shelter weight on top of BEA all-items (young renters spend more on housing
# than the all-items basket). 0.10 ≈ +10pp shelter share.
HOUSING_EXTRA_WEIGHT = 0.10
RPP_LINE_ALL = 1.0
RPP_LINE_HOUSING = 3.0

# Bootstrap
N_BOOT = 400  # full 1000 is slow; methodology allows ~1000 — raise for final publish
RANDOM_SEED = 42

# Carnegie class codes of interest (CCBASIC)
# 15=R1, 16=R2, 17=D/PU, 18=M1, 19=M2, 20=M3, 21=baccalaureate arts, 22=baccalaureate diverse, 23=baccalaureate/associate

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
PSEO_RETENTION_CACHE = PROCESSED / "pseo_retention.csv"
ADM_CSV = RAW / "ipeds" / "adm2023" / "adm2023.csv"
PUBLIC_RANKINGS = ROOT.parent / "public" / "data" / "rankings"

OPENALEX_MAILTO = "mailto:college-forge-ranking@example.com"
