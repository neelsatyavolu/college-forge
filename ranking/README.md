# Purchasing-Power College Ranking

Executable pipeline for [`METHODOLOGY.md`](METHODOLOGY.md) (v1.2).

**Headline question:** If I graduate from this school, how far will my paycheck go where I’m likely to end up living — and how well-regarded is the place that got me there?

Earnings are deflated by BEA prices with extra housing weight. Stayers are priced near campus; movers use PSEO Census-division destinations when observed, otherwise a modeled destination mix (not a flat national 100).

Not an ROI ranking: net price is reported, not scored.

## Quick start

```bash
cd ranking
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Data must already be under data/raw/ (see scripts below or re-download)
python src/run_all.py
```

Outputs land in `out/`:

| File | Description |
|---|---|
| `ranking.csv` | Full scored universe |
| `ranking_top250.csv` | Published cut |
| `ranking_by_major.csv` | Per-CIP value rankings (§12) |
| `ranking_value_added_top250.csv` | Residual-on-selectivity table (§7) |
| `exclusions.csv` | Every dropped school + reason |
| `sensitivity.csv` | §8 variants |
| `sources.md` | Pinned vintages + access date |
| `field_mapping.csv` | Source variable map |
| `DISCLOSURE.md` | Required disclosure block |
| `diagnostics.json` | Escalation flags, correlations, model R² |

## Data downloads (once)

```bash
mkdir -p data/raw/{institution,fos,marpp,sarpp,pseo,ipeds}
# Scorecard
curl -L -o data/raw/Most-Recent-Cohorts-Institution.zip \
  https://ed-public-download.scorecard.network/downloads/Most-Recent-Cohorts-Institution_06102026.zip
curl -L -o data/raw/Most-Recent-Cohorts-Field-of-Study.zip \
  https://ed-public-download.scorecard.network/downloads/Most-Recent-Cohorts-Field-of-Study_06102026.zip
# BEA RPP
curl -L -o data/raw/MARPP.zip https://apps.bea.gov/regional/zip/MARPP.zip
curl -L -o data/raw/SARPP.zip https://apps.bea.gov/regional/zip/SARPP.zip
# PSEO
curl -L -o data/raw/pseo/pseof_all.csv.gz \
  https://lehd.ces.census.gov/data/pseo/latest_release/all/pseof_all.csv.gz
curl -L -o data/raw/pseo/pseo_all_institutions.csv \
  https://lehd.ces.census.gov/data/pseo/latest_release/all/pseo_all_institutions.csv
# IPEDS yield
curl -L -o data/raw/ipeds/ADM2023.zip https://nces.ed.gov/ipeds/datacenter/data/ADM2023.zip
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
unzip -o data/raw/ipeds/ADM2023.zip -d data/raw/ipeds/adm2023
```

OpenAlex research metrics are fetched at runtime and cached in `data/processed/openalex_research.csv`.

## Escalations (methodology §11)

The pipeline **does not silently reverse** design decisions. Two conditions require human review before treating results as publishable:

1. **Value–reputation correlation r ≥ 0.5** → residualize reputation (auto-handled when true).
2. **Modeled retention > 50% of universe**, or **> 15% of schools below FoS coverage floor** → scope problem.

Check `out/diagnostics.json` after every run. `python -m unittest tests.test_rpp` covers the COL math.

## API keys

- **College Scorecard API** is optional for this bulk pipeline (CSV downloads are used).
- **OpenAlex** needs no key (polite pool via User-Agent mailto).
- Project Vercel env (for the College Forge app, not this batch job): `COLLEGE_SCORECARD_API_KEY`, `EXA_API_KEY`, `TINYFISH_API_KEY`, `BLOB_READ_WRITE_TOKEN`.
