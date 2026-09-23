"""Per-major rankings for bachelor's and master's programs (§5).

Within one major and credential, every school is compared against the same national
median, so ranking by premium equals ranking by cost-of-living-adjusted earnings.
Estimates shrink toward that national median in proportion to their noise; they never
borrow strength from the school's other majors. Only programs with published earnings
are ranked; nothing is imputed.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from config import MAJOR_MIN_SCHOOLS, N_BOOT, RANDOM_SEED
from cip_families import family_name


def _intervals(value: np.ndarray, sd: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    draws = value[None, :] + rng.normal(0.0, 1.0, (N_BOOT, len(value))) * sd[None, :]
    ranks = (-draws).argsort(axis=1).argsort(axis=1) + 1
    return np.percentile(ranks, 5, axis=0).round(), np.percentile(ranks, 95, axis=0).round()


def rank_majors(programs: pd.DataFrame, rpp: pd.DataFrame, universe_ids: set[int]) -> pd.DataFrame:
    df = programs[programs["UNITID"].isin(universe_ids) & programs["y_major"].notna()].copy()
    df["rpp_grad"] = df["UNITID"].map(rpp["rpp_grad"])
    df = df.dropna(subset=["rpp_grad"])
    col = np.log(df["rpp_grad"] / 100.0)
    df["premium"] = df["y_major"] - col
    df["premium_raw"] = df["y_raw"] - col
    df["nat_display"] = np.select(
        [df["earnings_horizon"] == "4yr", df["earnings_horizon"] == "5yr"],
        [df["nat_4yr"], df["nat_5yr"]],
        default=df["nat_1yr"],
    )
    rng = np.random.default_rng(RANDOM_SEED)
    parts = []
    for _, g in df.groupby(["credential", "CIPCODE"]):
        if g["UNITID"].nunique() < MAJOR_MIN_SCHOOLS:
            continue
        g = g.sort_values(["premium", "earners"], ascending=False).copy()
        g["rank"] = np.arange(1, len(g) + 1)
        g["n_ranked"] = len(g)
        lo, hi = _intervals(g["premium"].to_numpy(), g["y_major_sd"].to_numpy(), rng)
        g["rank_low"] = lo.astype(int)
        g["rank_high"] = hi.astype(int)
        parts.append(g)
    out = pd.concat(parts, ignore_index=True)
    out["family"] = out["CIPCODE"].str[:2].map(family_name)
    return out


def major_index(ranked: pd.DataFrame) -> pd.DataFrame:
    idx = (
        ranked.groupby(["credential", "CIPCODE"], as_index=False)
        .agg(name=("CIPDESC", "first"), family=("family", "first"),
             n_ranked=("n_ranked", "first"), national_median=("nat_4yr", "median"),
             graduates=("completions", "sum"))
        .sort_values(["credential", "graduates"], ascending=[True, False])
    )
    idx["graduates"] = idx["graduates"].round().astype(int)
    return idx
