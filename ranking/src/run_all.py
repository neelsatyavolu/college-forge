#!/usr/bin/env python3
"""
Purchasing-Power College Ranking — end-to-end pipeline.

Implements ranking/METHODOLOGY.md v1.2.
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
    HOUSING_EXTRA_WEIGHT,
    N_BOOT,
    OUT,
    PCE_CSV,
    PROCESSED,
    PUBLIC_RANKINGS,
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
    STATE_FIPS,
    campus_local_rpp,
    division_rpp_map,
    home_division,
    load_county_table,
    load_pce_deflator,
    state_rpp_map,
)
from pseo import (  # noqa: E402
    dest_emp_frame,
    extract_pseo_destinations,
    extract_pseo_retention,
    fit_retention_model,
    fit_rpp_grad_model,
    implied_leaver_pool,
    match_pseo_to_scorecard,
    rpp_grad_destination,
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
from util import opeid8, pctile_rank, spearman, write_csv  # noqa: E402


def _records(df: pd.DataFrame) -> list:
    return json.loads(df.to_json(orient="records"))


def export_public(ranking: pd.DataFrame, va: pd.DataFrame, major: pd.DataFrame, sens: pd.DataFrame, access_date: str):
    PUBLIC_RANKINGS.mkdir(parents=True, exist_ok=True)
    top = ranking.head(250)
    (PUBLIC_RANKINGS / "top250.json").write_text(json.dumps({
        "generated": access_date,
        "n": int(len(top)),
        "schools": _records(top),
    }))
    va_cols = [c for c in [
        "value_added_rank", "rank", "unitid", "institution", "state",
        "value_added", "value_metric", "composite_score",
    ] if c in va.columns]
    (PUBLIC_RANKINGS / "value_added.json").write_text(json.dumps({
        "schools": _records(va[va_cols].head(250)),
    }))
    if len(major):
        idx = (
            major.groupby(["cip_code", "cip_desc", "cip_family"], as_index=False)
            .size()
            .rename(columns={"size": "n"})
            .sort_values("n", ascending=False)
        )
        (PUBLIC_RANKINGS / "majors_index.json").write_text(json.dumps({"majors": _records(idx)}))
        top_maj = (
            major.sort_values(["cip_code", "rank_in_major"])
            .groupby("cip_code", as_index=False)
            .head(25)
        )
        keep = [c for c in [
            "cip_code", "cip_desc", "rank_in_major", "institution", "state",
            "value_metric_cip", "earnings_cip", "unitid", "institution_rank",
        ] if c in top_maj.columns]
        (PUBLIC_RANKINGS / "by_major_top25.json").write_text(json.dumps({"rows": _records(top_maj[keep])}))
    (PUBLIC_RANKINGS / "sensitivity.json").write_text(json.dumps(_records(sens)))
    for name in ("sources.md", "DISCLOSURE.md"):
        src = OUT / name
        if src.exists():
            (PUBLIC_RANKINGS / name).write_text(src.read_text())
    print(f"  wrote public rankings → {PUBLIC_RANKINGS}")


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
    st_young_map = {}
    st_pop_map = {}
    st_pop = counties.groupby("stfips")["pop"].sum()
    st_young = counties.groupby("stfips")["rpp_state_young"].median()
    fips_to_st = {v: k for k, v in STATE_FIPS.items()}
    for fips, r in st_young.items():
        ab = fips_to_st.get(str(fips).zfill(2))
        if ab:
            st_young_map[ab] = float(r)
            st_pop_map[ab] = float(st_pop.get(fips, 1.0))
    div_rpp = division_rpp_map(st_young_map, st_pop_map)
    print(f"  division young RPPs: " + ", ".join(f"{d}={div_rpp[d]:.1f}" for d in sorted(div_rpp)))

    # PCE: Scorecard 4yr earnings are approximately 2021–2022 dollars (cohort-dependent);
    # use 2022 → REFERENCE_YEAR as a transparent pin.
    pce_factor = load_pce_deflator(PCE_CSV, earnings_year=2022, ref_year=REFERENCE_YEAR)
    print(f"  PCE deflator 2022→{REFERENCE_YEAR}: {pce_factor:.4f}")
    print(f"  metro RPPs: {len(metro):,} | state RPPs: {len(state):,} | housing extra weight: {HOUSING_EXTRA_WEIGHT}")

    print(f"  computing campus-local RPP (radius={RADIUS_MI_DEFAULT} mi, renter-tilted)…")
    rpp_local = campus_local_rpp(df, counties, radius_mi=RADIUS_MI_DEFAULT, rpp_col="rpp_county")
    rpp_local_all = campus_local_rpp(df, counties, radius_mi=RADIUS_MI_DEFAULT, rpp_col="rpp_county_all")
    df["rpp_local"] = df["UNITID"].map(rpp_local)
    df["rpp_local_all"] = df["UNITID"].map(rpp_local_all)
    df["rpp_local"] = df["rpp_local"].fillna(df["STABBR"].map(st_young_map)).fillna(100.0)
    df["rpp_local_all"] = df["rpp_local_all"].fillna(df["STABBR"].map(st_map)).fillna(100.0)
    df["home_div"] = df["STABBR"].map(home_division)

    rpp_national_pool = float(
        np.average(counties["rpp_county"], weights=counties["pop"].clip(lower=1))
    )
    print(f"  RPP national pool (pop-weighted young): {rpp_national_pool:.2f}")

    print("=== 4. PSEO destinations + modeled fallback ===")
    pseo_ret = extract_pseo_retention()
    print(f"  PSEO retention rows: {len(pseo_ret):,}")
    matched = match_pseo_to_scorecard(df, pseo_ret)
    df["retention_share"] = matched["retention_share"].values
    df["retention_source"] = matched["retention_source"].values
    n_pseo = int((df["retention_source"] == "pseo").sum())
    print(f"  matched PSEO retention: {n_pseo:,} / {len(df):,} ({100*n_pseo/len(df):.1f}%)")

    dest_wide = extract_pseo_destinations()
    print(f"  PSEO destination institutions: {len(dest_wide):,}")
    opeids = matched["opeid8"] if "opeid8" in matched.columns else df["OPEID"].map(opeid8)
    dest = dest_emp_frame(dest_wide, df.index, opeids)
    n_dest = int((dest.sum(axis=1) > 0).sum())
    print(f"  matched PSEO destinations: {n_dest:,} / {len(df):,}")

    ret, src, ret_meta = fit_retention_model(df)
    df["retention_share"] = ret.values
    df["retention_source"] = src.values
    print(f"  retention model CV R²: {ret_meta.get('r2_cv')}")
    modeled_share = (df["retention_source"] == "modeled").mean()
    print(f"  modeled retention share: {modeled_share:.1%}")
    if modeled_share > 0.5:
        print("  ⚠ ESCALATION: modeled retention covers >50% of eligible universe (§11)")

    # Observed destination RPP for PSEO dest schools; leaver pool from those.
    rpp_obs = rpp_grad_destination(
        df["retention_share"],
        df["rpp_local"],
        df["home_div"],
        dest,
        div_rpp,
        leaver_pool=104.0,
    )
    has_dest = dest.sum(axis=1) > 0
    rpp_obs = rpp_obs.where(has_dest)
    leaver_pool = implied_leaver_pool(rpp_obs, df["retention_share"], df["rpp_local"])
    print(f"  implied OOS leaver-pool RPP: {leaver_pool:.2f}")
    # Recompute dest RPP with empirical leaver pool for the no-dest fallback inside dest fn
    rpp_obs = rpp_grad_destination(
        df["retention_share"],
        df["rpp_local"],
        df["home_div"],
        dest,
        div_rpp,
        leaver_pool=leaver_pool,
    ).where(has_dest)

    if int(rpp_obs.notna().sum()) < 40:
        print("  ⚠ few PSEO destinations; falling back to in-state × local + leaver pool")
        rpp_grad = rpp_grad_two_dest(df["retention_share"], df["rpp_local"], leaver_pool)
        rpp_src = pd.Series(
            np.where(df["retention_source"] == "pseo", "pseo_instate", "modeled"),
            index=df.index,
        )
        rpp_meta = {"r2_cv": None, "n_train": int(rpp_obs.notna().sum())}
    else:
        rpp_grad, rpp_src, rpp_meta = fit_rpp_grad_model(df, rpp_obs)
    df["rpp_grad"] = rpp_grad.values
    df["rpp_source"] = rpp_src.values
    # PSEO in-state but no dest rows: two-bucket with leaver pool, not national 100
    instate_only = (df["retention_source"] == "pseo") & (df["rpp_source"] == "modeled")
    if instate_only.any():
        df.loc[instate_only, "rpp_grad"] = rpp_grad_two_dest(
            df.loc[instate_only, "retention_share"],
            df.loc[instate_only, "rpp_local"],
            leaver_pool,
        ).values
        df.loc[instate_only, "rpp_source"] = "pseo_instate"
    print(f"  rpp_grad model CV R²: {rpp_meta.get('r2_cv')}")
    print(f"  rpp_source: {df['rpp_source'].value_counts().to_dict()}")
    print(f"  rpp_grad mean/min/max: {df['rpp_grad'].mean():.1f} / {df['rpp_grad'].min():.1f} / {df['rpp_grad'].max():.1f}")

    # Legacy two-dest (all-items, national 100) kept for sensitivity
    df["rpp_grad_legacy"] = rpp_grad_two_dest(
        df["retention_share"], df["rpp_local_all"], 100.0
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

    # local RPP vs destination-weighted
    c_local, _, _, _ = build_composite(
        df["value_metric_local_rpp"], df["reputation_raw"], residualize=diag["residualized_reputation"]
    )
    sens_variants["campus_local_rpp"] = c_local
    sens_variants["grad_weighted_rpp"] = df["composite_score"]

    # v1.1 two-bucket (campus all-items × instate + 100 × OOS)
    vm_legacy = value_metric(df["earnings_actual_mix"], df["rpp_grad_legacy"])
    c_legacy, _, _, _ = build_composite(
        vm_legacy, df["reputation_raw"], residualize=diag["residualized_reputation"]
    )
    sens_variants["legacy_two_dest"] = c_legacy

    # raw salary, no COL
    c_nocol, _, _, _ = build_composite(
        df["earnings_actual_mix"], df["reputation_raw"], residualize=diag["residualized_reputation"]
    )
    sens_variants["no_col"] = c_nocol

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
        "grad_feeder_rate", "grad_feeder_flag", "rpp_grad", "rpp_local", "rpp_source",
        "value_metric",
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
        {"source": "BEA MARPP", "variable": f"LineCode=1 year={RPP_YEAR}", "role": "metro_rpp_all_items"},
        {"source": "BEA MARPP", "variable": f"LineCode=3 year={RPP_YEAR}", "role": "metro_rpp_housing"},
        {"source": "BEA SARPP", "variable": f"LineCode=1 year={RPP_YEAR}", "role": "state_rpp_all_items"},
        {"source": "BEA SARPP", "variable": f"LineCode=3 year={RPP_YEAR}", "role": "state_rpp_housing"},
        {"source": "PSEO Flows", "variable": "y5_grads_emp_instate/y5_grads_emp", "role": "retention_share"},
        {"source": "PSEO Flows", "variable": "geo_level=D geography=Census division y5_grads_emp", "role": "destination_mix"},
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
        "n_pseo_dest_matched": int(n_dest),
        "modeled_retention_share": float(modeled_share),
        "rpp_source_counts": {str(k): int(v) for k, v in df["rpp_source"].value_counts().items()},
        "retention_model": ret_meta,
        "rpp_grad_model": rpp_meta,
        "leaver_pool_rpp": leaver_pool,
        "housing_extra_weight": HOUSING_EXTRA_WEIGHT,
        "pce_factor_2022_to_ref": pce_factor,
        "reference_year": REFERENCE_YEAR,
        "rpp_national_pool": rpp_national_pool,
        "division_rpp": {str(k): v for k, v in div_rpp.items()},
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

- PSEO retention matched: {n_pseo} / {len(df)} ({100*n_pseo/len(df):.1f}%)
- PSEO destination mix matched: {n_dest} / {len(df)} ({100*n_dest/len(df):.1f}%)
- Retention model CV R²: {ret_meta.get('r2_cv')}
- RPP-grad model CV R²: {rpp_meta.get('r2_cv')}
- Modeled retention share: {modeled_share:.1%}
- Implied out-of-state leaver-pool RPP: {leaver_pool:.2f}
- Housing extra weight: {HOUSING_EXTRA_WEIGHT}
- Value–reputation Pearson r: {diag['pearson_value_rep']:.3f}
- Residualized reputation: {diag['residualized_reputation']}

## Methodology

See `ranking/METHODOLOGY.md` v1.2. For-profit institutions excluded because earnings data is dominated by large chains and Title IV coverage differs sharply from nonprofits.
"""
    (OUT / "sources.md").write_text(sources)

    disclosure = """# Disclosure (publish with any public ranking)

1. Earnings cover only federal aid recipients and are not representative of all graduates, especially at wealthy institutions.
2. Cost of living uses BEA Regional Price Parities with extra weight on housing. Stayers are priced at the campus labor market. Movers are priced at Census-division destinations from PSEO when those flows exist; otherwise destinations are modeled. PSEO does not cover every state (California is absent).
3. In-state vs out-of-state is not the same as metro of employment. Division destinations are coarser than city.
4. Earnings reflect cohorts who graduated several years ago and may not describe current outcomes.
5. Rank differences within overlapping intervals are not meaningful.
6. Reputation is constructed from public data (IPEDS yield, OpenAlex citations, retention/completion) and is not a survey of anyone's opinion.
7. Only bachelor's degrees are scored. Schools marked as graduate-school feeders send an unusually large share of graduates into further education, and their four-year earnings understate eventual outcomes.
8. For-profit institutions are excluded.
9. Headline earnings follow each school's actual major mix. A nursing-heavy campus will outrank a similar school with more humanities graduates.
10. This ranking measures purchasing-power earnings and prestige. It does not measure teaching quality, wellbeing, net price, or whether a school is a good fit for any individual student. State income taxes are not deducted.

## Per-major ranking additional disclosures

1. CIP coding is inconsistent across institutions; a 2-digit CIP family view is provided via `cip_family`.
2. Selection bias is sharper at major level (into school, then into major).
3. Sample sizes are smaller; rank intervals are wide.
4. Per-major rows still use the school's overall destination RPP, not a major-specific destination mix.
"""
    (OUT / "DISCLOSURE.md").write_text(disclosure)

    export_public(ranking, va, major if len(major) else pd.DataFrame(), sens, access_date)

    # Console top 25
    print("\n=== TOP 25 ===")
    cols_show = ["rank", "institution", "state", "composite_score", "value_metric", "earnings_actual_mix", "rpp_grad", "rpp_source", "grad_feeder_flag"]
    print(ranking.head(25)[cols_show].to_string(index=False))
    print(f"\nDone. Outputs in {OUT}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)
