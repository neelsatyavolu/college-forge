# Sources

Methodology: **v3.0** (`ranking/METHODOLOGY.md`)
Access date (UTC): **2026-09-23**
Dollars: every figure restated in **2024** dollars (PCE) from each field's source year:

- `EARN_MDN_1YR`: 2022 dollars
- `EARN_MDN_4YR`: 2024 dollars
- `EARN_MDN_4YR_NAT`: 2024 dollars
- `EARN_MDN_5YR`: 2022 dollars
- `MD_EARN_WNE_P10`: 2022 dollars

| Dataset | Release / vintage | URL |
|---|---|---|
| College Scorecard Institution | Most-Recent-Cohorts_06102026 | ed-public-download.scorecard.network |
| College Scorecard Field of Study | Most-Recent-Cohorts_06102026 | ed-public-download.scorecard.network |
| College Scorecard data dictionary (dollar years, cohorts) | June 10, 2026 | collegescorecard.ed.gov/files/CollegeScorecardDataDictionary.xlsx |
| BEA Regional Price Parities (metro + state) | 2008-2024, year used=2024 | apps.bea.gov/regional/zip/ |
| Census LEHD PSEO Flows | R2025Q4 / latest_release 2025Q4 | lehd.ces.census.gov/data/pseo/ |
| FRED PCE Price Index | PCEPI | fred.stlouisfed.org |
| Census county centroids / population / CBSA | CenPop2020, co-est2023, 2023 delineation | www2.census.gov |

## Coverage

- Overall ranking: 1,281 schools scored
- Per-major rankings: 156 bachelors, 85 masters
- Graduate cost of living: 1,717 schools; PSEO destinations observed for 458; modeled for 73%
- Graduate price model: cross-validated R² 0.904, held-out log error 0.016 (used in rank ranges for modeled schools)
- Implied out-of-state destination price level: 99.7

## Shrinkage

- bachelors: 26,671 programs at 1,586 schools · school-effect SD τ=0.146 · program SD ω=0.081 · price prior α=-0.003, β=0.00
- masters: 10,055 programs at 1,252 schools · school-effect SD τ=0.127 · program SD ω=0.128 · price prior α=0.007, β=0.00
