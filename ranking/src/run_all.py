#!/usr/bin/env python3
"""Forge Career Outcomes Ranking — end-to-end pipeline (ranking/METHODOLOGY.md v3.1)."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import HORIZON_SHIFT_LEVEL, OUT  # noqa: E402
from destinations import graduate_rpp  # noqa: E402
from export import export_all  # noqa: E402
from dollars import factors_used  # noqa: E402
from institutions import apply_eligibility, employment_rate, load_institutions, major_universe  # noqa: E402
from majors import major_index, rank_majors  # noqa: E402
from overall import (  # noqa: E402
    beats_expectations,
    completion_weighted_effect,
    components,
    coverage,
    eligible_for_scoring,
    rank_intervals,
    score_table,
    sensitivity,
)
from programs import (  # noqa: E402
    expected_earnings,
    fit_horizon_shift,
    load_programs,
    price_prior,
    program_estimates,
    program_premiums,
    school_effects,
    shrinkage_sd,
)
from reports import DISCLOSURE, sources_md  # noqa: E402
from util import write_csv  # noqa: E402

META = ["INSTNM", "CITY", "STABBR", "CONTROL", "net_price", "COSTT4_A", "PCTPELL"]


def _bachelors_effect(effects: pd.DataFrame) -> pd.Series:
    return effects[effects["credential"] == "bachelors"].set_index("UNITID")["mu_hat"]


def typical_earnings(programs: pd.DataFrame) -> pd.Series:
    """
    Completion-weighted MEAN of bachelor's program medians (4-year where published,
    else 5- or 1-year). An indicator of typical early earnings across the major mix,
    not the median of all graduates.
    """
    b = programs[(programs["credential"] == "bachelors") & programs["earnings_display"].notna()]
    b = b.assign(wx=b["earnings_display"] * b["completions"])
    g = b[b["completions"] > 0].groupby("UNITID")
    return (g["wx"].sum() / g["completions"].sum()).rename("typical_earnings")


def fallback_share(programs: pd.DataFrame) -> pd.Series:
    """Share of a school's scored bachelor's programs that use 5-year (older class) earnings."""
    b = programs[(programs["credential"] == "bachelors") & programs["y_raw"].notna()]
    return (b["earnings_horizon"] == "5yr").groupby(b["UNITID"]).mean().rename("fallback_share")


def build_overall(inst, eligible, programs, effects, effects_adj, effects_4yr, rpp):
    """Headline table (earnings as reported) with the after-cost-of-living ordering joined."""
    elig = eligible.assign(employment_rate=employment_rate(eligible))
    expected = expected_earnings(programs)
    comp = components(elig, effects, expected, rpp, adjust_prices=False)
    comp, excl_cov = eligible_for_scoring(comp, coverage(programs))
    comp_adj = components(elig, effects_adj, expected, rpp, adjust_prices=True).loc[comp.index]

    table = score_table(comp)
    table = table.join(rank_intervals(table))
    adjusted = score_table(comp_adj)
    adjusted = adjusted.join(rank_intervals(adjusted))
    table = table.join(adjusted[["rank", "rank_low", "rank_high", "score", "early_premium", "later_premium"]].rename(columns={
        "rank": "rank_adjusted", "rank_low": "rank_adjusted_low", "rank_high": "rank_adjusted_high",
        "score": "score_adjusted", "early_premium": "early_premium_adjusted", "later_premium": "later_premium_adjusted",
    }))
    meta = inst.set_index("UNITID")
    table = table.join(meta[META + ["MD_EARN_WNE_P10"]]).join(rpp[["rpp_grad", "rpp_source"]])
    table["typical_earnings"] = typical_earnings(programs).reindex(table.index)
    table["fallback_share"] = fallback_share(programs).reindex(table.index)
    table["earnings_10yr"] = table["MD_EARN_WNE_P10"]
    table["beats_expectations"], beats_fit = beats_expectations(table, inst)
    table["beats_rank"] = table["beats_expectations"].rank(ascending=False, method="first")

    # Coverage floors: a school's estimate does not depend on the floor, so these variants
    # only show how re-standardizing on a smaller universe moves the remaining schools.
    cov = comp["coverage"]
    alternatives = {
        "with_cost_of_living": comp_adj,
        "coverage_at_least_50pct": comp[cov >= 0.5],
        "coverage_at_least_70pct": comp[cov >= 0.7],
        "completion_weighted_programs": comp.assign(
            early_premium=completion_weighted_effect(programs).reindex(comp.index)
        ),
        "four_year_earnings_only": comp.assign(early_premium=_bachelors_effect(effects_4yr).reindex(comp.index)),
    }
    sens = sensitivity(comp, table["rank"], alternatives)
    return table, comp, excl_cov, sens, beats_fit


def main() -> int:
    access_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    OUT.mkdir(parents=True, exist_ok=True)

    print("=== 1. Institutions & universes ===")
    inst = load_institutions()
    eligible, exclusions = apply_eligibility(inst)
    majors_pool = major_universe(inst)
    print(f"  overall-eligible: {len(eligible):,} | per-major universe: {len(majors_pool):,}")

    print("=== 2. Program earnings premiums ===")
    programs = load_programs()
    programs = programs[programs["UNITID"].isin(set(majors_pool["UNITID"]))]
    horizon = fit_horizon_shift(programs, HORIZON_SHIFT_LEVEL)
    programs = program_premiums(programs, log_sd=shrinkage_sd(programs), shift=horizon)

    print("=== 3. Graduate cost of living ===")
    need = set(eligible["UNITID"]) | set(programs.loc[programs["y_raw"].notna(), "UNITID"])
    rpp, geo_diag = graduate_rpp(inst[inst["UNITID"].isin(need)])
    print(f"  {geo_diag['n_schools']:,} schools · PSEO destinations {geo_diag['n_pseo_destinations']:,} · modeled {geo_diag['modeled_share']:.0%}")

    print("=== 3b. Shrinkage (backtest-selected hierarchical model) ===")
    # Headline (as reported): flat prior, so no modeled geography enters it at all.
    flat = pd.Series(0.0, index=rpp.index)
    effects, pool_diag = school_effects(programs, flat, price_prior(programs, flat))
    nominal = program_estimates(programs, effects, pool_diag)
    # Alternative (after cost of living): price-aware prior, then divide by graduate prices.
    log_price = np.log(rpp["rpp_grad"] / 100.0)
    effects_adj, diag_adj = school_effects(programs, log_price, price_prior(programs, log_price))
    adjusted = program_estimates(programs, effects_adj, diag_adj)
    # Sensitivity: school effects from 4-year earnings only (no 5-year fallback programs).
    four_only = programs.assign(y_raw=programs["y_raw"].where(programs["earnings_horizon"] == "4yr"))
    effects_4yr, _ = school_effects(four_only, flat, price_prior(four_only, flat))
    programs = nominal.assign(
        y_program_px=adjusted["y_program"].values,
        y_program_px_sd=adjusted["y_program_sd"].values,
        price_loading=adjusted["price_loading"].values,
    )
    for cred, d in pool_diag.items():
        print(f"  {cred}: {d['programs']:,} programs, {d['schools']:,} schools, τ={d['tau']:.3f}, ω={d['omega']:.3f}, α={d['alpha']:.3f}; adjusted-view β={diag_adj[cred]['beta']:.2f}")

    print("=== 4. Overall score ===")
    table, comp, excl_cov, sens, beats_fit = build_overall(inst, eligible, programs, effects, effects_adj, effects_4yr, rpp)
    print(f"  scored: {len(table):,} | dropped (thin earnings coverage or no graduation rate): {len(excl_cov):,}")
    print(sens.to_string(index=False))

    print("=== 5. Per-major rankings ===")
    ranked = rank_majors(programs, rpp, set(majors_pool["UNITID"]))
    ranked = ranked.merge(inst[["UNITID", "INSTNM", "CITY", "STABBR", "CONTROL"]], on="UNITID", suffixes=("", "_inst"))
    index = major_index(ranked)
    n_majors = index.groupby("credential").size().to_dict()
    print(f"  majors ranked: {n_majors}")

    print("=== 6. Outputs ===")
    names = inst.set_index("UNITID")[["INSTNM", "STABBR"]]
    excl_cov = excl_cov.join(names, on="UNITID")
    exclusions = pd.concat([exclusions, excl_cov], ignore_index=True)
    write_csv(table.reset_index(), OUT / "ranking.csv")
    write_csv(ranked, OUT / "ranking_by_major.csv")
    write_csv(exclusions, OUT / "exclusions.csv")
    write_csv(sens, OUT / "sensitivity.csv")
    (OUT / "diagnostics.json").write_text(json.dumps({
        "access_date": access_date, "dollar_factors_to_reference_year": factors_used(),
        "pooling": pool_diag, "pooling_adjusted_view": diag_adj,
        "geography": geo_diag, "beats_expectations_fit": beats_fit,
        "horizon_shift": {"level": horizon.level, "by_credential": horizon.by_credential,
                          "majors_fitted": int(len(horizon.by_major))},
        "five_year_fallback": {
            "ranked_programs": int((ranked["earnings_horizon"] == "5yr").sum()),
            "of_ranked_programs": int(len(ranked)),
            "in_major_top25": int(((ranked["earnings_horizon"] == "5yr") & (ranked["rank"] <= 25)).sum()),
            "overall_scored_schools_majority_fallback": int((table["fallback_share"] > 0.5).sum()),
        },
        "n_scored": int(len(table)), "n_excluded": int(len(exclusions)), "majors": n_majors,
        "component_coverage": {c: int(comp[c].notna().sum()) for c in ("early_premium", "later_premium", "graduation", "employment")},
    }, indent=2, default=str))
    (OUT / "sources.md").write_text(sources_md(access_date, geo_diag, pool_diag, len(table), n_majors))
    (OUT / "DISCLOSURE.md").write_text(DISCLOSURE)
    export_all(table, len(eligible), ranked, index, sens, beats_fit, access_date)

    print("\n=== TOP 30 ===")
    show = table.head(30).assign(early=lambda d: np.round(d["early_premium"], 3))
    print(show[["rank", "rank_low", "rank_high", "rank_adjusted", "INSTNM", "STABBR", "score", "early", "graduation", "employment"]].to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
