#!/usr/bin/env python3
"""
Purchasing-Power College Ranking — end-to-end pipeline.

Implements college-ranking-methodology.md v1.1.
"""
from __future__ import annotations

import json
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

# Allow running as script from ranking/src
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import (  # noqa: E402
    COMPOSITE_REP_W,
    COMPOSITE_VALUE_W,
    N_BOOT,
    OUT,
    PCE_CSV,
    PROCESSED,
    RADIUS_MI_DEFAULT,
    RADIUS_MI_SENS,
    REFERENCE_YEAR,
    REP_WEIGHTS,
    ROOT,
    SCORECARD_RELEASE,
    PSEO_RELEASE,
    BEA_RPP_YEARS,
    RPP_YEAR,
    COHORT_FLOOR,
)
from earnings import (  # noqa: E402
    aggregate_school_earnings,
    apply_eligibility,
    fill_institution_earnings,
    grad_feeder_rate,
    load_fos_bachelors,
    load_institutions,
)
from geo import (  # noqa: E402
    campus_local_rpp,
    load_county_table,
    load_pce_deflator,
    load_rpp_tables,
    state_rpp_map,
)
from pseo import (  # noqa: E402
    extract_pseo_retention,
    fit_retention_model,
    match_pseo_to_scorecard,
    rpp_grad_two_dest,
)
from reputation import (  # noqa: E402
    fetch_openalex_research,
    load_yield,
    outcomes_score,
    reputation_composite,
    research_within_carnegie,
)
from score import (  # noqa: E402
    bootstrap_ranks,
    build_composite,
    per_major_ranking,
    rank_with_ties,
    sensitivity_table,
    value_added_residual,
    value_metric,
)
from util import pctile_rank, spearman, write_csv  # noqa: E402


def main():
    access_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    OUT.mkdir(parents=True, exist_ok=True)
    PROCESSED.mkdir(parents=True, exist_ok=True)

    print("=== 1. Load institutions & eligibility ===")
    inst = load_institutions()
    eligible, exclusions = apply_eligibility(inst)
    print(f"  eligible: {len(eligible):,} | excluded so far: {len(exclusions):,}")

    print("=== 2. Field-of-study earnings ===")
    fos = load_fos_bachelors()
    metrics, scored_cips, excl_cov = aggregate_school_earnings(
        fos, set(eligible["UNITID"].tolist())
    )
    metrics = fill_institution_earnings(metrics, eligible)
    # Drop still-missing earnings
    miss_earn = metrics["earnings_actual_mix"].isna()
    for _, r in metrics.loc[miss_earn].iterrows():
        excl_cov = pd.concat([excl_cov, pd.DataFrame([{
            "UNITID": r["UNITID"],
            "INSTNM": "",
            "STABBR": "",
            "reason": "missing_earnings",
            "field": "earnings_actual_mix",
            "failing_value": "nan",
        }])], ignore_index=True)
    metrics = metrics.loc[~miss_earn].copy()
    exclusions = pd.concat([exclusions, excl_cov], ignore_index=True)

    # Attach school metadata
    meta_cols = [
        "UNITID", "INSTNM", "CITY", "STABBR", "CONTROL", "CCBASIC", "ADM_RATE",
        "SAT_AVG", "ACTCMMID", "RET_FT4", "C150_4", "PCTPELL", "PCTFLOAN",
        "FIRST_GEN", "LATITUDE", "LONGITUDE", "UGDS", "REGION", "net_price",
        "COSTT4_A", "OPEID", "OPEID6",
    ]
    # Counts / institution earnings already attached in fill_institution_earnings
    extra = ["MD_EARN_WNE_4YR", "MD_EARN_WNE_P10", "COUNT_WNE_4YR", "COUNT_NWNE_4YR"]
    for c in extra:
        if c not in metrics.columns and c in eligible.columns:
            meta_cols.append(c)
    meta_cols = [c for c in meta_cols if c in eligible.columns]
    df = metrics.merge(eligible[meta_cols], on="UNITID", how="inner", suffixes=("", "_dup"))
    df = df.loc[:, ~df.columns.str.endswith("_dup")]
    print(f"  schools with earnings path: {len(df):,}")

    # Grad feeder
    if "COUNT_WNE_4YR" not in df.columns:
        df = df.merge(
            eligible[["UNITID", "COUNT_WNE_4YR", "COUNT_NWNE_4YR"]],
            on="UNITID",
            how="left",
        )
    gf = grad_feeder_rate(df)
    df["grad_feeder_rate"] = gf.values
    thr = df["grad_feeder_rate"].quantile(0.80)
    df["grad_feeder_flag"] = df["grad_feeder_rate"] >= thr

    print("=== 3. Geography / RPP ===")
    counties, metro, state, nonmetro_us = load_county_table()
    st_map = state_rpp_map(state)
    # PCE: Scorecard 4yr earnings are approximately 2021–2022 dollars (cohort-dependent);
    # use 2022 → REFERENCE_YEAR as a transparent pin.
    pce_factor = load_pce_deflator(PCE_CSV, earnings_year=2022, ref_year=REFERENCE_YEAR)
    print(f"  PCE deflator 2022→{REFERENCE_YEAR}: {pce_factor:.4f}")
    print(f"  metro RPPs: {len(metro):,} | state RPPs: {len(state):,} | nonmetro US: {nonmetro_us:.1f}")

    print(f"  computing campus-local RPP (radius={RADIUS_MI_DEFAULT} mi)…")
    rpp_local = campus_local_rpp(df, counties, radius_mi=RADIUS_MI_DEFAULT)
    df["rpp_local"] = df["UNITID"].map(rpp_local)
    # Fallback: state RPP
    df["rpp_local"] = df["rpp_local"].fillna(df["STABBR"].map(st_map)).fillna(100.0)

    # National pool: ACS-style approx = US average RPP for working-age = 100 by definition
    # Use population-weighted mean of county RPPs as graduate pool (≈100)
    rpp_national_pool = float(
        np.average(counties["rpp_county"], weights=counties["pop"].clip(lower=1))
    )
    print(f"  RPP national pool (pop-weighted counties): {rpp_national_pool:.2f}")

    print("=== 4. PSEO retention + modeled fallback ===")
    pseo_ret = extract_pseo_retention()
    print(f"  PSEO retention rows: {len(pseo_ret):,}")
    matched = match_pseo_to_scorecard(df, pseo_ret)
    df["retention_share"] = matched["retention_share"].values
    df["retention_source"] = matched["retention_source"].values
    n_pseo = int((df["retention_source"] == "pseo").sum())
    print(f"  matched PSEO: {n_pseo:,} / {len(df):,} ({100*n_pseo/len(df):.1f}%)")

    ret, src, ret_meta = fit_retention_model(df)
    df["retention_share"] = ret.values
    df["retention_source"] = src.values
    print(f"  retention model CV R²: {ret_meta.get('r2_cv')}")
    modeled_share = (df["retention_source"] == "modeled").mean()
    print(f"  modeled retention share: {modeled_share:.1%}")
    if modeled_share > 0.5:
        print("  ⚠ ESCALATION: modeled retention covers >50% of eligible universe (§11)")

    df["rpp_grad"] = rpp_grad_two_dest(
        df["retention_share"], df["rpp_local"], rpp_national_pool
    )

    # Deflate earnings
    df["earnings_actual_mix"] = df["earnings_actual_mix"] * pce_factor
    df["earnings_fixed_mix"] = df["earnings_fixed_mix"] * pce_factor
    df["earnings_10yr"] = df.get("earnings_10yr", df["MD_EARN_WNE_P10"]) * pce_factor
    df["horizon_gap"] = df["earnings_10yr"] - df["earnings_actual_mix"]

    df["value_metric"] = value_metric(df["earnings_actual_mix"], df["rpp_grad"])
    df["value_metric_fixed"] = value_metric(
        df["earnings_fixed_mix"].fillna(df["earnings_actual_mix"]), df["rpp_grad"]
    )
    df["value_metric_local_rpp"] = value_metric(df["earnings_actual_mix"], df["rpp_local"])

    print("=== 5. Reputation ===")
    yield_rate = load_yield()
    df["yield_rate"] = df["UNITID"].map(yield_rate)
    # Fallback: when yield missing, use inverse admit rate scaled (not ideal but documented)
    df["yield_rate"] = df["yield_rate"].fillna((1 - df["ADM_RATE"]).clip(0.05, 0.9) * 0.5)

    fwci = fetch_openalex_research(df[["UNITID", "INSTNM"]])
    df["fwci"] = df["UNITID"].map(fwci)
    df["research_pctile"] = research_within_carnegie(df["fwci"], df["CCBASIC"])
    df["outcomes_pctile"] = outcomes_score(df["RET_FT4"], df["C150_4"])
    df["reputation_raw"] = reputation_composite(
        df["yield_rate"], df["research_pctile"], df["outcomes_pctile"]
    )

    print("=== 6. Composite + residualization test ===")
    df = df.set_index("UNITID", drop=False)
    comp, v_pct, r_pct, diag = build_composite(df["value_metric"], df["reputation_raw"])
    df["composite_score"] = comp
    df["value_pctile"] = v_pct
    df["reputation_pctile"] = r_pct
    print(f"  Pearson(value, rep)={diag['pearson_value_rep']:.3f} residualized={diag['residualized_reputation']}")

    df["rank"] = rank_with_ties(df["composite_score"], df["value_metric"])

    print("=== 7. Value-added residual ===")
    df["value_added"] = value_added_residual(df["value_metric"], df)

    print(f"=== 8. Bootstrap ranks (n={N_BOOT}) ===")
    boot = bootstrap_ranks(
        df["earnings_actual_mix"],
        df["rpp_grad"],
        df["reputation_raw"],
        earn_n=df.get("COUNT_WNE_4YR"),
        n_boot=N_BOOT,
        residualize=bool(diag["residualized_reputation"]),
    )
    df["rank_low"] = boot["rank_low"]
    df["rank_high"] = boot["rank_high"]

    print("=== 9. Sensitivity ===")
    # Radius variants
    sens_variants = {}
    for rad in RADIUS_MI_SENS:
        if rad == RADIUS_MI_DEFAULT:
            sens_variants[f"radius_{int(rad)}"] = df["composite_score"]
            continue
        rl = campus_local_rpp(df.reset_index(drop=True), counties, radius_mi=rad)
        rloc = df["UNITID"].map(rl).fillna(df["rpp_local"])
        rg = rpp_grad_two_dest(df["retention_share"], rloc, rpp_national_pool)
        vm = value_metric(df["earnings_actual_mix"], rg)
        c, _, _, _ = build_composite(vm, df["reputation_raw"], residualize=diag["residualized_reputation"])
        sens_variants[f"radius_{int(rad)}"] = c

    sens_variants["actual_mix"] = df["composite_score"]
    c_fixed, _, _, _ = build_composite(
        df["value_metric_fixed"], df["reputation_raw"], residualize=diag["residualized_reputation"]
    )
    sens_variants["fixed_mix"] = c_fixed

    for rw in (0.0, 0.15, 0.30, 0.45):
        vw = 1 - rw
        c = vw * df["value_pctile"] + rw * df["reputation_pctile"]
        sens_variants[f"rep_weight_{int(rw*100)}"] = c

    # z-score transform
    def z(s):
        return (s - s.mean()) / s.std(ddof=0)

    c_z = COMPOSITE_VALUE_W * z(df["value_metric"]) + COMPOSITE_REP_W * z(df["reputation_raw"])
    sens_variants["zscore_transform"] = c_z

    # PSEO-only
    pseo_only = df[df["retention_source"] == "pseo"]
    if len(pseo_only) > 50:
        sens_variants["pseo_only"] = pseo_only["composite_score"]

    # local RPP vs grad-weighted
    c_local, _, _, _ = build_composite(
        df["value_metric_local_rpp"], df["reputation_raw"], residualize=diag["residualized_reputation"]
    )
    sens_variants["campus_local_rpp"] = c_local
    sens_variants["grad_weighted_rpp"] = df["composite_score"]

    # reputation sub-weights
    for label, w in [
        ("rep_40_40_20", {"yield": 0.4, "research": 0.4, "outcomes": 0.2}),
        ("rep_50_30_20", {"yield": 0.5, "research": 0.3, "outcomes": 0.2}),
        ("rep_30_50_20", {"yield": 0.3, "research": 0.5, "outcomes": 0.2}),
    ]:
        rr = reputation_composite(df["yield_rate"], df["research_pctile"], df["outcomes_pctile"], w)
        c, _, _, _ = build_composite(df["value_metric"], rr, residualize=diag["residualized_reputation"])
        sens_variants[label] = c

    # 10yr diagnostic
    vm10 = value_metric(df["earnings_10yr"].fillna(df["earnings_actual_mix"]), df["rpp_grad"])
    c10, _, _, _ = build_composite(vm10, df["reputation_raw"], residualize=diag["residualized_reputation"])
    sens_variants["earnings_10yr"] = c10

    # exclude grad feeders
    non_feeder = df[~df["grad_feeder_flag"].fillna(False)]
    sens_variants["exclude_grad_feeders"] = non_feeder["composite_score"]

    base_for_sens = df[["rank"]].copy()
    sens = sensitivity_table(base_for_sens, sens_variants)

    # Radius 25 vs 50 spearman for §4.4 drop rule
    if "radius_25" in sens_variants and "radius_50" in sens_variants:
        sp = spearman(
            sens_variants["radius_25"].rank(ascending=False),
            sens_variants["radius_50"].rank(ascending=False),
        )
        print(f"  radius 25 vs 50 Spearman: {sp:.4f}")
        if sp > 0.98:
            print("  → radius does little work; methodology allows dropping to CBSA-only")

    print("=== 10. Per-major rankings ===")
    # attach INSTNM to scored cips
    name_map = df.set_index("UNITID")["INSTNM"]
    st_map2 = df.set_index("UNITID")["STABBR"]
    scored_cips = scored_cips.copy()
    scored_cips["INSTNM"] = scored_cips["UNITID"].map(name_map)
    scored_cips["STABBR"] = scored_cips["UNITID"].map(st_map2)
    scored_cips["earnings_4yr"] = scored_cips["earnings_4yr"] * pce_factor
    major = per_major_ranking(
        scored_cips,
        df.set_index("UNITID")["rpp_grad"],
        df.set_index("UNITID")["rank"],
    )
    print(f"  major rows: {len(major):,} | majors: {major['cip_code'].nunique() if len(major) else 0}")

    print("=== 11. Write outputs ===")
    # Fill names on exclusions
    name_lookup = inst.set_index("UNITID")["INSTNM"]
    st_lookup = inst.set_index("UNITID")["STABBR"]
    exclusions["INSTNM"] = exclusions["INSTNM"].replace("", np.nan).fillna(
        exclusions["UNITID"].map(name_lookup)
    )
    exclusions["STABBR"] = exclusions["STABBR"].replace("", np.nan).fillna(
        exclusions["UNITID"].map(st_lookup)
    )

    control_label = {1: "public", 2: "private_nonprofit", 3: "private_forprofit"}
    out = df.copy()
    out["control"] = out["CONTROL"].map(control_label)
    out["carnegie_class"] = out["CCBASIC"]
    out["institution"] = out["INSTNM"]
    out["city"] = out["CITY"]
    out["state"] = out["STABBR"]
    out["pct_pell"] = out["PCTPELL"]
    out["pct_fedloan"] = out["PCTFLOAN"]
    out["cost_of_attendance"] = out["COSTT4_A"]
    out["unitid"] = out["UNITID"]

    ranking_cols = [
        "rank", "rank_low", "rank_high", "unitid", "institution", "city", "state",
        "control", "carnegie_class", "composite_score", "value_pctile", "reputation_pctile",
        "earnings_actual_mix", "earnings_fixed_mix", "earnings_10yr", "horizon_gap",
        "grad_feeder_rate", "grad_feeder_flag", "rpp_grad", "rpp_local", "value_metric",
        "value_added", "retention_share", "retention_source", "earnings_source",
        "fos_coverage", "top5_share", "n_cips_scored", "pct_pell", "pct_fedloan",
        "net_price", "cost_of_attendance",
    ]
    ranking = out.sort_values("rank")[ranking_cols].copy()
    # Scale composite to 0-100 display (already percentile blend)
    ranking["composite_score"] = ranking["composite_score"].round(2)
    ranking["value_pctile"] = ranking["value_pctile"].round(2)
    ranking["reputation_pctile"] = ranking["reputation_pctile"].round(2)

    write_csv(ranking, OUT / "ranking.csv")
    write_csv(ranking.head(250), OUT / "ranking_top250.csv")
    write_csv(exclusions, OUT / "exclusions.csv")
    write_csv(sens, OUT / "sensitivity.csv")
    if len(major):
        write_csv(major, OUT / "ranking_by_major.csv")

    # Secondary table: value-added ranking
    va = ranking.dropna(subset=["value_added"]).sort_values("value_added", ascending=False).copy()
    va.insert(0, "value_added_rank", np.arange(1, len(va) + 1))
    write_csv(va.head(250), OUT / "ranking_value_added_top250.csv")

    # Field mapping
    field_map = pd.DataFrame([
        {"source": "Scorecard Institution", "variable": "PREDDEG", "role": "eligibility"},
        {"source": "Scorecard Institution", "variable": "CONTROL", "role": "eligibility"},
        {"source": "Scorecard Institution", "variable": "CURROPER", "role": "eligibility"},
        {"source": "Scorecard Institution", "variable": "MAIN", "role": "eligibility"},
        {"source": "Scorecard Institution", "variable": "UGDS", "role": "eligibility"},
        {"source": "Scorecard Institution", "variable": "DISTANCEONLY", "role": "eligibility"},
        {"source": "Scorecard FoS", "variable": "EARN_MDN_4YR", "role": "earnings_4yr_scored"},
        {"source": "Scorecard FoS", "variable": "IPEDSCOUNT1/2", "role": "completions_weight"},
        {"source": "Scorecard FoS", "variable": "CREDLEV=3", "role": "bachelors_filter"},
        {"source": "Scorecard Institution", "variable": "MD_EARN_WNE_4YR", "role": "earnings_fallback"},
        {"source": "Scorecard Institution", "variable": "MD_EARN_WNE_P10", "role": "earnings_10yr_reported"},
        {"source": "Scorecard Institution", "variable": "COUNT_NWNE_4YR/COUNT_WNE_4YR", "role": "grad_feeder_proxy"},
        {"source": "BEA MARPP", "variable": f"LineCode=1 year={RPP_YEAR}", "role": "metro_rpp"},
        {"source": "BEA SARPP", "variable": f"LineCode=1 year={RPP_YEAR}", "role": "state_rpp"},
        {"source": "PSEO Flows", "variable": "y5_grads_emp_instate/y5_grads_emp", "role": "retention_share"},
        {"source": "IPEDS ADM2023", "variable": "ENRLT/ADMSSN", "role": "yield_rate"},
        {"source": "OpenAlex", "variable": "summary_stats.2yr_mean_citedness", "role": "research"},
        {"source": "Scorecard Institution", "variable": "RET_FT4,C150_4", "role": "outcomes"},
        {"source": "FRED PCEPI", "variable": "PCEPI", "role": "deflator"},
    ])
    write_csv(field_map, OUT / "field_mapping.csv")

    # Diagnostics JSON
    diag_out = {
        **diag,
        "access_date": access_date,
        "n_eligible_scored": int(len(ranking)),
        "n_excluded": int(len(exclusions)),
        "n_pseo_matched": n_pseo,
        "modeled_retention_share": float(modeled_share),
        "retention_model": ret_meta,
        "pce_factor_2022_to_ref": pce_factor,
        "reference_year": REFERENCE_YEAR,
        "rpp_national_pool": rpp_national_pool,
        "rep_weights": REP_WEIGHTS,
        "composite_weights": {"value": COMPOSITE_VALUE_W, "reputation": COMPOSITE_REP_W},
        "fos_coverage_below_floor_pct": float(
            (exclusions["reason"] == "fos_coverage_below_0.30").sum() / max(1, len(eligible))
        ),
    }
    (OUT / "diagnostics.json").write_text(json.dumps(diag_out, indent=2, default=str))
    print(f"  wrote {OUT / 'diagnostics.json'}")

    sources = f"""# Sources

Access date (UTC): **{access_date}**
Reference year for dollars: **{REFERENCE_YEAR}**
PCE deflator factor (2022→{REFERENCE_YEAR}): **{pce_factor:.6f}**

| Dataset | Release / vintage | Path / URL |
|---|---|---|
| College Scorecard Institution | {SCORECARD_RELEASE} | `data/raw/institution/` · ed-public-download.scorecard.network |
| College Scorecard Field of Study | {SCORECARD_RELEASE} | `data/raw/fos/` |
| BEA Regional Price Parities (metro) | {BEA_RPP_YEARS}, year used={RPP_YEAR} | apps.bea.gov/regional/zip/MARPP.zip |
| BEA Regional Price Parities (state) | {BEA_RPP_YEARS}, year used={RPP_YEAR} | apps.bea.gov/regional/zip/SARPP.zip |
| Census LEHD PSEO Flows | {PSEO_RELEASE} | lehd.ces.census.gov/data/pseo/latest_release/all/pseof_all.csv.gz |
| IPEDS Admissions | ADM2023 | nces.ed.gov/ipeds/datacenter/data/ADM2023.zip |
| OpenAlex Institutions API | live at access date | api.openalex.org |
| FRED PCE Price Index | PCEPI | fred.stlouisfed.org |
| Census county centroids | CenPop2020 | www2.census.gov/geo/docs/reference/cenpop2020/county/ |
| Census county population | co-est2023 | www2.census.gov/programs-surveys/popest/ |
| CBSA delineation | 2023 list1 | www2.census.gov/programs-surveys/metro-micro/ |

## Coverage notes

- PSEO matched schools: {n_pseo} / {len(df)} ({100*n_pseo/len(df):.1f}%)
- Retention model CV R²: {ret_meta.get('r2_cv')}
- Modeled retention share: {modeled_share:.1%}
- Value–reputation Pearson r: {diag['pearson_value_rep']:.3f}
- Residualized reputation: {diag['residualized_reputation']}

## Methodology

See `college-ranking-methodology.md` v1.1. For-profit institutions excluded because earnings data is dominated by large chains and Title IV coverage differs sharply from nonprofits.
"""
    (OUT / "sources.md").write_text(sources)

    disclosure = """# Disclosure (publish with any public ranking)

1. Earnings cover only federal aid recipients and are not representative of all graduates, especially at wealthy institutions.
2. Graduate employment locations are observed for a subset of schools (PSEO participants) and statistically modeled for the remainder.
3. Earnings reflect cohorts who graduated several years ago and may not describe current outcomes.
4. Rank differences within overlapping intervals are not meaningful.
5. Reputation is constructed from public data (IPEDS yield, OpenAlex citations, retention/completion) and is not a survey of anyone's opinion.
6. Only bachelor's degrees are scored. Schools marked as graduate-school feeders send an unusually large share of graduates into further education, and their four-year earnings understate eventual outcomes.
7. For-profit institutions are excluded.
8. This ranking measures earnings and prestige. It does not measure teaching quality, wellbeing, or whether a school is a good fit for any individual student.

## Per-major ranking additional disclosures

1. CIP coding is inconsistent across institutions; a 2-digit CIP family view is provided via `cip_family`.
2. Selection bias is sharper at major level (into school, then into major).
3. Sample sizes are smaller; rank intervals are wide.
"""
    (OUT / "DISCLOSURE.md").write_text(disclosure)

    # Console top 25
    print("\n=== TOP 25 ===")
    cols_show = ["rank", "institution", "state", "composite_score", "value_metric", "earnings_actual_mix", "rpp_grad", "grad_feeder_flag"]
    print(ranking.head(25)[cols_show].to_string(index=False))
    print(f"\nDone. Outputs in {OUT}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)
