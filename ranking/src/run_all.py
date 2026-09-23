#!/usr/bin/env python3
"""Forge Career Outcomes Ranking — end-to-end pipeline (ranking/METHODOLOGY.md v2.0)."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import OUT  # noqa: E402
from destinations import graduate_rpp  # noqa: E402
from export import export_all  # noqa: E402
from dollars import factors_used  # noqa: E402
from institutions import apply_eligibility, employment_rate, load_institutions, major_universe  # noqa: E402
from majors import major_index, rank_majors  # noqa: E402
from overall import (  # noqa: E402
    beats_expectations,
    components,
    coverage,
    eligible_for_scoring,
    rank_intervals,
    score_table,
    sensitivity,
)
from programs import (  # noqa: E402
    expected_earnings,
    load_programs,
    major_estimates,
    price_slope,
    program_premiums,
    school_effects,
)
from reports import DISCLOSURE, sources_md  # noqa: E402
from util import write_csv  # noqa: E402

META = ["INSTNM", "CITY", "STABBR", "CONTROL", "net_price", "COSTT4_A", "PCTPELL"]


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


def build_overall(inst, eligible, programs, effects, rpp):
    elig = eligible.assign(employment_rate=employment_rate(eligible))
    comp = components(elig, effects, expected_earnings(programs), rpp)
    comp, excl_cov = eligible_for_scoring(comp, coverage(programs))
    table = score_table(comp)
    table = table.join(rank_intervals(table))
    meta = inst.set_index("UNITID")
    table = table.join(meta[META + ["MD_EARN_WNE_P10"]]).join(rpp[["rpp_grad", "rpp_source"]])
    table["typical_earnings"] = typical_earnings(programs).reindex(table.index)
    table["earnings_10yr"] = table["MD_EARN_WNE_P10"]
    table["beats_expectations"] = beats_expectations(table, inst)
    table["beats_rank"] = table["beats_expectations"].rank(ascending=False, method="first")

    # Same schools, no cost-of-living adjustment: a full alternative ranking users can switch to.
    no_col = rpp.assign(rpp_grad=100.0, rpp_log_sd=0.0)
    comp_nominal = components(elig, effects, expected_earnings(programs), no_col).loc[comp.index]
    nominal = score_table(comp_nominal)
    nominal = nominal.join(rank_intervals(nominal))
    table = table.join(nominal[["rank", "rank_low", "rank_high", "score", "early_premium", "long_premium"]].rename(columns={
        "rank": "rank_nominal", "rank_low": "rank_nominal_low", "rank_high": "rank_nominal_high",
        "score": "score_nominal", "early_premium": "early_premium_nominal", "long_premium": "long_premium_nominal",
    }))
    sens = sensitivity(comp, table["rank"], {"no_cost_of_living": comp_nominal})
    return table, comp, excl_cov, sens


def main() -> int:
    access_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    OUT.mkdir(parents=True, exist_ok=True)

    print("=== 1. Institutions & universes ===")
    inst = load_institutions()
    eligible, exclusions = apply_eligibility(inst)
    majors_pool = major_universe(inst)
    print(f"  overall-eligible: {len(eligible):,} | per-major universe: {len(majors_pool):,}")

    print("=== 2. Program earnings premiums ===")
    programs = program_premiums(load_programs())
    programs = programs[programs["UNITID"].isin(set(majors_pool["UNITID"]))]

    print("=== 3. Graduate cost of living ===")
    need = set(eligible["UNITID"]) | set(programs.loc[programs["y_raw"].notna(), "UNITID"])
    rpp, geo_diag = graduate_rpp(inst[inst["UNITID"].isin(need)])
    print(f"  {geo_diag['n_schools']:,} schools · PSEO destinations {geo_diag['n_pseo_destinations']:,} · modeled {geo_diag['modeled_share']:.0%}")

    print("=== 3b. Shrinkage (price-aware priors) ===")
    log_price = np.log(rpp["rpp_grad"] / 100.0)
    beta = price_slope(programs, log_price)
    effects, pool_diag = school_effects(programs, log_price, beta)
    programs = major_estimates(programs, log_price, beta)
    for cred, d in pool_diag.items():
        print(f"  {cred}: {d['programs']:,} programs, {d['schools']:,} schools, τ={d['tau']:.3f}, ω={d['omega']:.3f}, price slope β={beta[cred]:.2f}")

    print("=== 4. Overall score ===")
    table, comp, excl_cov, sens = build_overall(inst, eligible, programs, effects, rpp)
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
        "price_slope": beta, "pooling": pool_diag, "geography": geo_diag,
        "n_scored": int(len(table)), "n_excluded": int(len(exclusions)), "majors": n_majors,
        "component_coverage": {c: int(comp[c].notna().sum()) for c in ("early_premium", "long_premium", "graduation", "employment")},
    }, indent=2, default=str))
    (OUT / "sources.md").write_text(sources_md(access_date, geo_diag, pool_diag, beta, len(table), n_majors))
    (OUT / "DISCLOSURE.md").write_text(DISCLOSURE)
    export_all(table, len(eligible), ranked, index, sens, access_date)

    print("\n=== TOP 30 ===")
    show = table.head(30).assign(early=lambda d: np.round(d["early_premium"], 3), long=lambda d: np.round(d["long_premium"], 3))
    print(show[["rank", "rank_low", "rank_high", "INSTNM", "STABBR", "score", "early", "long", "graduation", "employment"]].to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
