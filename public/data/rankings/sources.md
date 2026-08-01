# Sources

Access date (UTC): **2026-08-01**
Reference year for dollars: **2024**
PCE deflator factor (2022→2024): **1.065165**

| Dataset | Release / vintage | Path / URL |
|---|---|---|
| College Scorecard Institution | Most-Recent-Cohorts_06102026 | `data/raw/institution/` · ed-public-download.scorecard.network |
| College Scorecard Field of Study | Most-Recent-Cohorts_06102026 | `data/raw/fos/` |
| BEA Regional Price Parities (metro) | 2008-2024, year used=2024 | apps.bea.gov/regional/zip/MARPP.zip |
| BEA Regional Price Parities (state) | 2008-2024, year used=2024 | apps.bea.gov/regional/zip/SARPP.zip |
| Census LEHD PSEO Flows | R2025Q4 / latest_release 2025Q4 | lehd.ces.census.gov/data/pseo/latest_release/all/pseof_all.csv.gz |
| IPEDS Admissions | ADM2023 | nces.ed.gov/ipeds/datacenter/data/ADM2023.zip |
| OpenAlex Institutions API | live at access date | api.openalex.org |
| FRED PCE Price Index | PCEPI | fred.stlouisfed.org |
| Census county centroids | CenPop2020 | www2.census.gov/geo/docs/reference/cenpop2020/county/ |
| Census county population | co-est2023 | www2.census.gov/programs-surveys/popest/ |
| CBSA delineation | 2023 list1 | www2.census.gov/programs-surveys/metro-micro/ |

## Coverage notes

- PSEO matched schools: 296 / 782 (37.9%)
- Retention model CV R²: 0.1772074556217999
- Modeled retention share: 62.1%
- Value–reputation Pearson r: 0.213
- Residualized reputation: False

## Methodology

See `college-ranking-methodology.md` v1.1. For-profit institutions excluded because earnings data is dominated by large chains and Title IV coverage differs sharply from nonprofits.
