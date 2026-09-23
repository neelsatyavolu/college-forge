"""sources.md and DISCLOSURE.md, regenerated on every run."""
from __future__ import annotations

from config import (
    BEA_RPP_YEARS,
    EARNINGS_COHORTS,
    FIELD_DOLLAR_YEAR,
    METHODOLOGY_VERSION,
    PSEO_RELEASE,
    REFERENCE_YEAR,
    RPP_YEAR,
    SCORECARD_RELEASE,
)

DISCLOSURE = f"""# Disclosure (publish with any public ranking)

This is a **comparison of past graduates' outcomes** for students who received federal aid and graduated several years ago. Its program earnings estimates were backtested in a corrected retrospective evaluation: built only from earlier graduating classes, they predicted the next classes better than the alternatives tested on institutions excluded from the final calibration and selection, and separate 90% next-class prediction intervals (which also include the next class's own sampling noise) held the next classes' results 91–94% of the time. The narrower intervals behind published rank ranges, the rank ranges themselves and the composite weights are not validated to that level. It is not a forecast for any individual student, and it does not measure what a college causes.

1. **Outcomes, no direct weight on selectivity.** The score uses early-career earnings (50%), graduation (31.25%) and employment (18.75%). A 10-years-after-entry earnings figure is shown but not scored (it mixes entrants and graduates). Admit rate, test scores, yield, research, spending and reputation are not scored. Admissions variables are used in two places: the model that predicts where graduates work (when that is not observed) and the separate "Beats expectations" view.
2. **Same-major comparisons.** Earnings are compared with the national median for the same major and credential, so a school is not rewarded or penalized for which majors it offers.
3. **Federal aid recipients only.** Scorecard earnings and employment cover students who received federal grants or loans. At wealthy colleges that can be a minority of students. International students are not included.
4. **Cohorts are old.** Scored: {EARNINGS_COHORTS['4yr']} (4-year earnings), else {EARNINGS_COHORTS['5yr']} (5-year). Not scored: {EARNINGS_COHORTS['1yr']} (1-year, partly pandemic years); {EARNINGS_COHORTS['10yr_entry']} (later earnings, shown). Employment describes 2014–16 graduates' working status in 2018–19 (older than the earnings data); graduation describes students who started around fall 2018. The page refresh date is not the outcome date.
5. **Dollars.** Every figure is restated in {REFERENCE_YEAR} dollars from each field's own source year using the PCE price index. Earnings are annual W-2 wages and self-employment earnings, not base salary.
6. **The page ranks after cost of living by default; an as-reported ordering (no geography) is one click away.** The cost-of-living ordering adjusts with BEA Regional Price Parities (plus extra housing weight). Where graduates work is observed from Census PSEO for about a quarter of schools and modeled for the rest, and that model is not yet externally validated. The as-reported ordering avoids these assumptions and is the one the backtest checks. State taxes are not deducted.
7. **Uncertainty.** Rank ranges (5th–95th percentile) redraw each earnings estimate and, in the cost-of-living view, the modeled price level. They describe uncertainty in each estimate, not the spread of a future class's result, and are conditional on the model; they are not empirically calibrated. (At their published width, program intervals contained the next class's result 83% of the time for bachelor's and 91% for master's in the backtest, as expected for intervals that leave out the next class's own sampling noise.) Weights and other specification choices are reported as sensitivity. Overlapping ranges are a reason not to over-read the exact order; they do not prove two schools are equal.
8. **Small programs are shrunk.** A school's programs are pooled into one school effect; each program's estimate is pulled toward that effect in proportion to how noisy its own data are. This borrowing was chosen because it predicted the next graduating class better; what is borrowed is the school's measured outcomes, not reputation.
9. **Only published cells are ranked.** A school missing from a major table may not offer the major, may report it under a related code, may have suppressed earnings, or may rank below the top 250 shown.
10. **"Beats expectations" is not causal.** It is the gap between a school's score and a cross-fitted prediction from SAT/ACT, admit rate, Pell share and first-generation share. Unmeasured student differences and model error can drive it.
11. **Excluded:** for-profit and online-only institutions, and schools in U.S. territories (no BEA price data). The overall table requires a first-time-student graduation rate. Four scored schools have no employment figure; their score uses the other two components with weights rescaled.
12. **Not measured:** teaching quality, job quality or fit, wellbeing, upper-tail outcomes, or price. Net price is shown for context only.

## Per-major tables

1. Majors are 4-digit federal CIP categories; they may not match catalog program names, and one code can bundle specialties (for example, nurse anesthesia sits inside registered nursing).
2. Degree earnings are not occupation outcomes: a journalism graduate working in marketing counts toward journalism earnings.
3. Per-major cost of living uses the school's bachelor's-graduate destinations for every major and for master's programs. **Master's tables are experimental**: graduate students' locations, ages and prior experience can differ sharply from undergraduates'.
4. A program is scored on 4-year earnings, or 5-year earnings (an older class) where the 4-year figure is suppressed (about 9% of estimates). The 5-year national baseline is an earner-weighted median of program medians, since Scorecard publishes no official 5-year national median. Programs with only 1-year earnings are not ranked.
"""


def sources_md(access_date: str, geo_diag: dict, pool_diag: dict, n_ranked: int, n_majors: dict) -> str:
    pool_lines = "\n".join(
        f"- {cred}: {d['programs']:,} programs at {d['schools']:,} schools · school-effect SD τ={d['tau']:.3f} · program SD ω={d['omega']:.3f} · price prior α={d['alpha']:.3f}, β={d['beta']:.2f}"
        for cred, d in pool_diag.items()
    )
    dollar_lines = "\n".join(f"- `{f}`: {y} dollars" for f, y in FIELD_DOLLAR_YEAR.items())
    majors_line = ", ".join(f"{v} {k}" for k, v in n_majors.items())
    rpp_model = geo_diag["rpp_grad_model"]
    return f"""# Sources

Methodology: **v{METHODOLOGY_VERSION}** (`ranking/METHODOLOGY.md`)
Access date (UTC): **{access_date}**
Dollars: every figure restated in **{REFERENCE_YEAR}** dollars (PCE) from each field's source year:

{dollar_lines}

| Dataset | Release / vintage | URL |
|---|---|---|
| College Scorecard Institution | {SCORECARD_RELEASE} | ed-public-download.scorecard.network |
| College Scorecard Field of Study | {SCORECARD_RELEASE} | ed-public-download.scorecard.network |
| College Scorecard data dictionary (dollar years, cohorts) | June 10, 2026 | collegescorecard.ed.gov/files/CollegeScorecardDataDictionary.xlsx |
| BEA Regional Price Parities (metro + state) | {BEA_RPP_YEARS}, year used={RPP_YEAR} | apps.bea.gov/regional/zip/ |
| Census LEHD PSEO Flows | {PSEO_RELEASE} | lehd.ces.census.gov/data/pseo/ |
| FRED PCE Price Index | PCEPI | fred.stlouisfed.org |
| Census county centroids / population / CBSA | CenPop2020, co-est2023, 2023 delineation | www2.census.gov |

## Coverage

- Overall ranking: {n_ranked:,} schools scored
- Per-major rankings: {majors_line}
- Graduate cost of living: {geo_diag['n_schools']:,} schools; PSEO destinations observed for {geo_diag['n_pseo_destinations']:,}; modeled for {geo_diag['modeled_share']:.0%}
- Graduate price model: cross-validated R² {rpp_model.get('r2_cv', float('nan')):.3f}, held-out log error {rpp_model.get('log_rmse_cv', float('nan')):.3f} (used in rank ranges for modeled schools)
- Implied out-of-state destination price level: {geo_diag['leaver_pool_rpp']:.1f}

## Shrinkage

{pool_lines}
"""


__all__ = ["DISCLOSURE", "sources_md"]
