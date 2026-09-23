"""sources.md and DISCLOSURE.md, regenerated on every run."""
from __future__ import annotations

from config import (
    BEA_RPP_YEARS,
    EARNINGS_DOLLAR_YEAR,
    METHODOLOGY_VERSION,
    PSEO_RELEASE,
    REFERENCE_YEAR,
    RPP_YEAR,
    SCORECARD_RELEASE,
)

DISCLOSURE = """# Disclosure (publish with any public ranking)

1. **Outcomes, not inputs.** Scores use graduate earnings, graduation and employment. Admit rate, test scores, yield, research output, spending and reputation surveys are not scored.
2. **Same-major comparisons.** Earnings are compared with the national median for the same major and credential, so a school is not rewarded or penalized for which majors it offers.
3. **Federal data only covers federal aid recipients.** Earnings and employment come from College Scorecard, which tracks students who received federal grants or loans. At wealthy schools this is a minority of students.
4. **Cohorts are several years old.** Early-career earnings are 1, 4 and 5 years after graduation; long-run earnings are 10 years after entry. They may not describe current graduates.
5. **Cost of living** uses BEA Regional Price Parities with extra weight on housing, priced where graduates actually work (Census PSEO destinations) or a modeled mix where PSEO does not report (for example, California). State income taxes are not deducted.
6. **Small programs are shrunk, not dropped.** Estimates from few graduates are pulled toward the school's overall pattern and then toward the national average in proportion to their uncertainty. Rank ranges (5th–95th percentile) are published; ranks inside overlapping ranges are not meaningfully different.
7. **Only published cells are ranked.** Programs whose earnings are suppressed for privacy are not ranked in the per-major tables. Nothing is imputed.
8. **Selection is not removed from the headline score.** Schools that admit students with more advantages will tend to show better outcomes. The "Beats expectations" view shows outcomes relative to what the incoming student body predicts.
9. **Excluded:** for-profit institutions, online-only institutions, and schools in U.S. territories (no BEA price data; separate labor markets).
10. **Not measured:** teaching quality, wellbeing, fit, or price. Net price is shown for context only.

## Per-major tables

1. Majors are 4-digit CIP codes as reported by each school; coding varies across schools.
2. Selection is sharper at the major level (into the school, then into the major).
3. Per-major cost of living uses the school's overall graduate destinations, not a major-specific mix.
4. Master's programs use the same graduate cost-of-living estimate as the school's bachelor's graduates.
"""


def sources_md(access_date: str, pce: float, geo_diag: dict, pool_diag: dict, n_ranked: int, n_majors: dict) -> str:
    pool_lines = "\n".join(
        f"- {cred}: {d['programs']:,} programs at {d['schools']:,} schools · school-effect SD τ={d['tau']:.3f} · program SD ω={d['omega']:.3f}"
        for cred, d in pool_diag.items()
    )
    majors_line = ", ".join(f"{v} {k}" for k, v in n_majors.items())
    return f"""# Sources

Methodology: **v{METHODOLOGY_VERSION}** (`ranking/METHODOLOGY.md`)
Access date (UTC): **{access_date}**
Dollars: **{REFERENCE_YEAR}** (PCE factor {EARNINGS_DOLLAR_YEAR}→{REFERENCE_YEAR}: {pce:.4f})

| Dataset | Release / vintage | URL |
|---|---|---|
| College Scorecard Institution | {SCORECARD_RELEASE} | ed-public-download.scorecard.network |
| College Scorecard Field of Study | {SCORECARD_RELEASE} | ed-public-download.scorecard.network |
| BEA Regional Price Parities (metro + state) | {BEA_RPP_YEARS}, year used={RPP_YEAR} | apps.bea.gov/regional/zip/ |
| Census LEHD PSEO Flows | {PSEO_RELEASE} | lehd.ces.census.gov/data/pseo/ |
| FRED PCE Price Index | PCEPI | fred.stlouisfed.org |
| Census county centroids / population / CBSA | CenPop2020, co-est2023, 2023 delineation | www2.census.gov |

## Coverage

- Overall ranking: {n_ranked:,} schools scored
- Per-major rankings: {majors_line}
- Graduate cost of living: {geo_diag['n_schools']:,} schools; PSEO destinations observed for {geo_diag['n_pseo_destinations']:,}; modeled for {geo_diag['modeled_share']:.0%}
- Implied out-of-state destination price level: {geo_diag['leaver_pool_rpp']:.1f}

## Partial pooling

{pool_lines}
"""


__all__ = ["DISCLOSURE", "sources_md"]
