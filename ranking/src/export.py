"""Public JSON for /rankings and the recommendation engine.

Every dollar value is already in REFERENCE_YEAR dollars (converted per field at load,
see dollars.py); nothing here applies another inflation factor.
"""
from __future__ import annotations

import json
import shutil

import numpy as np
import pandas as pd

from config import (
    COST_OF_LIVING_WEIGHT,
    EARNINGS_COHORTS,
    MAJOR_TOP_N,
    METHODOLOGY_VERSION,
    OUT,
    OVERALL_TOP_N,
    OVERALL_WEIGHTS,
    PUBLIC_RANKINGS,
    REFERENCE_YEAR,
)

CONTROL = {1: "public", 2: "private_nonprofit"}
MAJOR_SCORING = (
    "Modeled earnings premium vs. the national median for the same major and credential "
    "(4-year earnings, else 5-year earnings mapped onto the 4-year scale), shrunk toward the "
    "school's effect in proportion to its noise (selected by next-class prediction). "
    "Graduation and employment are not scored in major tables."
)


def _records(df: pd.DataFrame) -> list:
    return json.loads(df.to_json(orient="records", double_precision=4))


def _write(path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":")))


def _pct(log_ratio: pd.Series) -> pd.Series:
    return (np.exp(log_ratio) - 1.0) * 100.0


def _count(s: pd.Series) -> pd.Series:
    """Counts with zero or missing shown as unknown, never as 0 graduates."""
    return s.where(s > 0).round()


def _ranks(table: pd.DataFrame) -> dict:
    cols = {}
    for suffix in ("", "_partial", "_adjusted"):
        for part in ("", "_low", "_high"):
            cols[f"rank{suffix}{part}"] = table[f"rank{suffix}{part}"]
    return cols


def school_rows(table: pd.DataFrame) -> pd.DataFrame:
    """table: scored schools (UNITID index). Unsuffixed = as reported, _partial = page default, _adjusted = full."""
    out = pd.DataFrame({
        **_ranks(table),
        "unitid": table.index.astype(int),
        "institution": table["INSTNM"],
        "city": table["CITY"],
        "state": table["STABBR"],
        "control": table["CONTROL"].map(CONTROL),
        "score": table["score"].round(1),
        "score_partial": table["score_partial"].round(1),
        "score_adjusted": table["score_adjusted"].round(1),
        "early_premium_pct": _pct(table["early_premium"]).round(1),
        "early_premium_partial_pct": _pct(table["early_premium_partial"]).round(1),
        "early_premium_adjusted_pct": _pct(table["early_premium_adjusted"]).round(1),
        "later_premium_pct": _pct(table["later_premium"]).round(1),
        "later_premium_partial_pct": _pct(table["later_premium_partial"]).round(1),
        "later_premium_adjusted_pct": _pct(table["later_premium_adjusted"]).round(1),
        "graduation_rate": table["graduation"].round(3),
        "employment_rate": table["employment"].round(3),
        "typical_earnings": table["typical_earnings"].round(-2),
        "earnings_10yr": table["earnings_10yr"].round(-2),
        "rpp_grad": table["rpp_grad"].round(1),
        "location_observed": table["rpp_source"] == "pseo_dest",
        "program_coverage": table["coverage"].round(2),
        "fallback_share": table["fallback_share"].round(2),
        "net_price": table["net_price"],
        "cost_of_attendance": table["COSTT4_A"],
        "pct_pell": table["PCTPELL"].round(3),
        "beats_expectations": table["beats_expectations"].round(1),
        "beats_rank": table["beats_rank"],
    })
    for c in ("early_premium", "early_premium_partial", "early_premium_adjusted", "graduation", "employment"):
        out[f"{c}_pctile"] = (table[c].rank(pct=True) * 100).round(0)
    return out


def major_rows(g: pd.DataFrame, overall_ranks: pd.DataFrame) -> pd.DataFrame:
    """overall_ranks: unitid-indexed overall rank per ordering (rank, rank_partial, rank_adjusted)."""
    horizon_count = {"1yr": "EARN_COUNT_WNE_1YR", "4yr": "EARN_COUNT_WNE_4YR", "5yr": "EARN_COUNT_WNE_5YR"}
    shown_count = pd.Series(np.nan, index=g.index)
    for h, col in horizon_count.items():
        shown_count = shown_count.where(g["earnings_horizon"] != h, g[col])
    return pd.DataFrame({
        **_ranks(g),
        "unitid": g["UNITID"].astype(int),
        "institution": g["INSTNM_inst"],
        "city": g["CITY"],
        "state": g["STABBR"],
        "control": g["CONTROL_inst"].map(CONTROL),
        "premium_pct": _pct(g["y_program"]).round(1),
        "premium_partial_pct": _pct(g["premium_partial"]).round(1),
        "premium_adjusted_pct": _pct(g["premium_adjusted"]).round(1),
        "earnings": g["earnings_display"].round(-2),
        "earnings_horizon": g["earnings_horizon"],
        "earnings_count": _count(shown_count),
        "earnings_adjusted": (g["earnings_display"] / (g["rpp_grad"] / 100)).round(-2),
        "earners_1yr": _count(g["EARN_COUNT_WNE_1YR"]),
        "earners_4yr": _count(g["EARN_COUNT_WNE_4YR"]),
        "earners_5yr": _count(g["EARN_COUNT_WNE_5YR"]),
        "completions": _count(g["completions"]),
        "location_observed": g["rpp_source"] == "pseo_dest",
        **{f"overall_{c}": g["UNITID"].map(overall_ranks[c]) for c in ("rank", "rank_partial", "rank_adjusted")},
    })


def _top(df: pd.DataFrame, n: int) -> pd.DataFrame:
    """Rows in the top n under any ordering, so switching orderings never drops a school."""
    keep = (df["rank"] <= n) | (df["rank_partial"] <= n) | (df["rank_adjusted"] <= n)
    return df[keep].sort_values("rank")


def export_all(
    overall: pd.DataFrame,
    n_eligible: int,
    majors: pd.DataFrame,
    index: pd.DataFrame,
    sens: pd.DataFrame,
    beats_fit: dict,
    generated: str,
) -> None:
    majors_dir = PUBLIC_RANKINGS / "majors"
    if majors_dir.exists():
        shutil.rmtree(majors_dir)
    for stale in ("by_major_top25.json", "majors_index.json"):
        (PUBLIC_RANKINGS / stale).unlink(missing_ok=True)

    rows = school_rows(overall)
    base = {"generated": generated, "methodology_version": METHODOLOGY_VERSION,
            "dollar_year": REFERENCE_YEAR, "cohorts": EARNINGS_COHORTS}
    meta = {**base, "weights": OVERALL_WEIGHTS}
    # top250.json: top 250 in the page's default ordering (half cost of living); the
    # recommendation engine's candidate pool, so its ranks match what the page shows.
    default_top = rows[rows["rank_partial"] <= OVERALL_TOP_N].sort_values("rank_partial")
    _write(PUBLIC_RANKINGS / "top250.json", {
        **meta, "n_ranked": int(len(rows)), "n_eligible": n_eligible, "default_ordering": "partial", "cost_of_living_weight": COST_OF_LIVING_WEIGHT,
        "schools": _records(default_top),
    })
    # overall.json: top 250 under any ordering, for the page's cost-of-living toggle.
    _write(PUBLIC_RANKINGS / "overall.json", {
        **meta, "n_ranked": int(len(rows)), "n_eligible": n_eligible,
        "schools": _records(_top(rows, OVERALL_TOP_N)),
    })
    beats = rows.dropna(subset=["beats_rank"]).sort_values("beats_rank")
    _write(PUBLIC_RANKINGS / "value_added.json", {**meta, "fit": beats_fit, "schools": _records(beats.head(OVERALL_TOP_N))})

    overall_ranks = rows.set_index("unitid")[["rank", "rank_partial", "rank_adjusted"]]
    top_ids = set(default_top["unitid"])
    major_meta = {**base, "scoring": MAJOR_SCORING}
    by_school: dict[str, list] = {}
    for (cred, cip), g in majors.groupby(["credential", "CIPCODE"]):
        info = index[(index["credential"] == cred) & (index["CIPCODE"] == cip)].iloc[0]
        _write(majors_dir / f"{cred}-{cip}.json", {
            **major_meta, "credential": cred, "cip": cip, "name": info["name"], "family": info["family"],
            "national_median": None if pd.isna(info["national_median"]) else round(float(info["national_median"]), -2),
            "n_ranked": int(info["n_ranked"]),
            "rows": _records(major_rows(_top(g, MAJOR_TOP_N), overall_ranks)),
        })
        if cred == "bachelors":
            for r in g[g["UNITID"].isin(top_ids)].itertuples():
                # Default (half cost of living) program ranks, matching the page's default view.
                by_school.setdefault(str(int(r.UNITID)), []).append([cip, int(r.rank_partial), int(r.n_ranked)])

    idx = index.rename(columns={"CIPCODE": "cip"}).assign(national_median=lambda d: d["national_median"].round(-2))
    _write(majors_dir / "index.json", {**major_meta, "majors": _records(idx)})
    bach = index[index["credential"] == "bachelors"]
    _write(majors_dir / "bachelors_by_school.json", {
        **major_meta, "majors": dict(zip(bach["CIPCODE"], bach["name"])), "ranks": by_school,
    })
    _write(PUBLIC_RANKINGS / "sensitivity.json", _records(sens))
    backtest = OUT / "backtest.json"
    if backtest.exists():
        bt = json.loads(backtest.read_text())
        keep = ("estimator", "k", "test", "test_raw_baseline", "test_major_only_sd070", "test_major_only_tuned",
                "test_minus_raw_within_major_rmse_90ci", "test_minus_tuned_major_only_within_major_rmse_90ci",
                "strata", "strata_raw_baseline", "coverage_90", "coverage_90_target_under_50")
        _write(PUBLIC_RANKINGS / "validation.json", {
            "provenance": bt["provenance"], "design": bt["design"], "noise": bt["noise_calibration"],
            "horizon_mapping": bt["horizon_mapping"], "repeated_splits": bt["repeated_splits"],
            "chosen": {c: {k: v[k] for k in keep} for c, v in bt["chosen"].items()},
        })
    for name in ("sources.md", "DISCLOSURE.md"):
        shutil.copyfile(OUT / name, PUBLIC_RANKINGS / name)
    print(f"  wrote public rankings → {PUBLIC_RANKINGS}")
