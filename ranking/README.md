# Forge Career Outcomes Ranking

Executable pipeline for [`METHODOLOGY.md`](METHODOLOGY.md) (v3.0). Published at `/rankings`.

A comparison of past graduates' outcomes whose program earnings estimates are backtested against the next graduating class (METHODOLOGY §10). Not a causal estimate.

**Question:** if you study a given major at this school, how do graduates do in their careers compared with people who studied the same thing elsewhere?

The score uses outcomes only: early-career earnings vs. the same major nationally (50%), graduation (31.25%) and employment (18.75%). The headline ranks earnings as reported with no geography; a cost-of-living ordering is published alongside. Selectivity, yield, research, spending and reputation are not scored. Net price is reported, not scored.

## Quick start

```bash
cd ranking
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Data must already be under data/raw/ (see downloads below)
python src/backtest.py   # needs data/raw/all/ (historical files); writes out/backtest.json
python src/run_all.py
python -m unittest tests.test_scoring tests.test_rpp tests.test_data_contract tests.test_backtest tests.test_backtest_pins
```

## Modules (`src/`)

| Module | Role |
|---|---|
| `dollars.py` | Restates each earnings field from its documented source dollar year to 2024 dollars |
| `institutions.py` | Scorecard institution records, overall and per-major universes, employment rate |
| `programs.py` | Program earnings premiums (4-year else 5-year), OPEID6 matching, branch-campus collapse, school effects, hierarchical program estimates |
| `backtest.py` | Next-class backtest: noise calibration, estimator × shrinkage selection, held-out error and interval coverage |
| `destinations.py` | Graduate cost of living (BEA RPP × PSEO destinations, modeled fallback) |
| `geo.py`, `pseo.py` | Price parities, campus-local prices, PSEO retention/destinations |
| `overall.py` | Composite score, rank intervals, beats-expectations residual, sensitivity |
| `majors.py` | Per-major rankings (bachelor's and master's) |
| `export.py`, `reports.py` | Public JSON, `sources.md`, `DISCLOSURE.md` |
| `run_all.py` | Orchestration |

## Outputs

`out/` (local, for review):

| File | Description |
|---|---|
| `ranking.csv` | Every scored school with components, ranks and intervals |
| `ranking_by_major.csv` | Every ranked program |
| `exclusions.csv` | Every excluded school and the first rule it failed |
| `sensitivity.csv` | Spearman vs. headline under alternative weights and no cost-of-living adjustment |
| `diagnostics.json`, `sources.md`, `DISCLOSURE.md` | Run diagnostics and published notes |

`public/data/rankings/` (served to the app):

| File | Description |
|---|---|
| `top250.json` | Overall top 250 after cost of living (recommendation engine) |
| `overall.json` | Top 250 under either ordering (after / before cost of living), for the page |
| `value_added.json` | Top 250 by beats-expectations |
| `majors/index.json` | All ranked majors (bachelor's and master's) |
| `majors/{bachelors,masters}-{cip}.json` | Top 250 per major |
| `majors/bachelors_by_school.json` | Major ranks for overall top-250 schools (recommendation engine) |

## Data downloads (once)

```bash
mkdir -p data/raw/{institution,fos,marpp,sarpp,pseo,ipeds}
# Scorecard
curl -L -o data/raw/Most-Recent-Cohorts-Institution.zip \
  https://ed-public-download.scorecard.network/downloads/Most-Recent-Cohorts-Institution_06102026.zip
curl -L -o data/raw/Most-Recent-Cohorts-Field-of-Study.zip \
  https://ed-public-download.scorecard.network/downloads/Most-Recent-Cohorts-Field-of-Study_06102026.zip
# Scorecard data dictionary (source dollar years and cohorts per field)
curl -L --create-dirs -o data/raw/docs/CollegeScorecardDataDictionary.xlsx \
  https://collegescorecard.ed.gov/files/CollegeScorecardDataDictionary.xlsx
# BEA RPP
curl -L -o data/raw/MARPP.zip https://apps.bea.gov/regional/zip/MARPP.zip
curl -L -o data/raw/SARPP.zip https://apps.bea.gov/regional/zip/SARPP.zip
# PSEO
curl -L -o data/raw/pseo/pseof_all.csv.gz \
  https://lehd.ces.census.gov/data/pseo/latest_release/all/pseof_all.csv.gz
curl -L -o data/raw/pseo/pseo_all_institutions.csv \
  https://lehd.ces.census.gov/data/pseo/latest_release/all/pseo_all_institutions.csv
# Geo + PCE
curl -L -o data/raw/PCEPI.csv 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=PCEPI'
curl -L -o data/raw/CenPop2020_Mean_CO.txt \
  https://www2.census.gov/geo/docs/reference/cenpop2020/county/CenPop2020_Mean_CO.txt
curl -L -o data/raw/co-est2023-alldata.csv \
  https://www2.census.gov/programs-surveys/popest/datasets/2020-2023/counties/totals/co-est2023-alldata.csv
curl -L -o data/raw/cbsa_delineation.xlsx \
  https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx

unzip -o data/raw/Most-Recent-Cohorts-Institution.zip -d data/raw/institution
unzip -o data/raw/Most-Recent-Cohorts-Field-of-Study.zip -d data/raw/fos
unzip -o data/raw/MARPP.zip -d data/raw/marpp
unzip -o data/raw/SARPP.zip -d data/raw/sarpp
# Historical field-of-study files for the backtest (470 MB archive)
curl -L --create-dirs -o data/raw/all/College_Scorecard_Raw_Data_06102026.zip \
  https://ed-public-download.scorecard.network/downloads/College_Scorecard_Raw_Data_06102026.zip
unzip -o -j data/raw/all/College_Scorecard_Raw_Data_06102026.zip \
  "*/FieldOfStudyData1819_1920_PP.csv" "*/FieldOfStudyData1920_2021_PP.csv" -d data/raw/all
```

## Review checklist after each run

1. Run `src/backtest.py` first. If it selects different σ, floor or k, update `config.py`; `tests/test_backtest_pins.py` fails until they match. Settings are chosen by the backtest, never by how the list looks.
2. `tests/test_data_contract.py` must pass: published earnings match the official Scorecard file. On a new Scorecard release, re-check `config.FIELD_DOLLAR_YEAR` against the data dictionary's cohort maps first.
3. `sensitivity.csv`: every variant should keep Spearman ≥ 0.85 with the headline. A large drop means one component is driving the ranking.
4. `exclusions.csv`: check that exclusion counts by reason are stable between data releases.
5. Spot-check per-major tables for programs whose rank comes from very few earners (wide rank ranges are expected; a tight range with few earners is a bug).
6. Weights in `config.py` are fixed a priori. Change them only with a written rationale in `METHODOLOGY.md`, never to make results look familiar.
