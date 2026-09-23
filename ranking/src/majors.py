"""Per-major rankings for bachelor's and master's programs (§5).

The ranked quantity is a modeled earnings premium: a program's median earnings relative
to the national median for the same major and credential, pooled across the 1-, 4- and
5-year horizons and shrunk toward a price-aware prior in proportion to its noise
(programs.major_estimates). It never borrows the school's results in other majors.
Two orderings are published: after cost of living (default) and before it. Only programs
with published earnings are ranked; nothing is imputed.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from cip_families import family_name
from config import MAJOR_MIN_SCHOOLS, N_BOOT, RANDOM_SEED


def _ranks(value: np.ndarray) -> np.ndarray:
    return (-value).argsort(kind="stable").argsort() + 1


def _intervals(value: np.ndarray, sd: np.ndarray, price_sd: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    noise = rng.normal(0.0, 1.0, (N_BOOT, len(value))) * sd[None, :]
    price = rng.normal(0.0, 1.0, (N_BOOT, len(value))) * price_sd[None, :]
    draws = value[None, :] + noise - price
    ranks = (-draws).argsort(axis=1).argsort(axis=1) + 1
    return np.percentile(ranks, 5, axis=0).round(), np.percentile(ranks, 95, axis=0).round()


def _rank_group(g: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    g = g.copy()
    sd = g["y_major_sd"].to_numpy()
    for suffix, value, price_sd in (
        ("", g["premium"].to_numpy(), g["rpp_log_sd"].to_numpy()),
        ("_nominal", g["y_major"].to_numpy(), np.zeros(len(g))),
    ):
        g[f"rank{suffix}"] = _ranks(value)
        lo, hi = _intervals(value, sd, price_sd, rng)
        g[f"rank{suffix}_low"] = lo.astype(int)
        g[f"rank{suffix}_high"] = hi.astype(int)
    g["n_ranked"] = len(g)
    return g.sort_values("rank")


def rank_majors(programs: pd.DataFrame, rpp: pd.DataFrame, universe_ids: set[int]) -> pd.DataFrame:
    df = programs[programs["UNITID"].isin(universe_ids) & programs["y_major"].notna()].copy()
    df["rpp_grad"] = df["UNITID"].map(rpp["rpp_grad"])
    df["rpp_source"] = df["UNITID"].map(rpp["rpp_source"])
    df["rpp_log_sd"] = df["UNITID"].map(rpp["rpp_log_sd"]).fillna(0.0)
    df = df.dropna(subset=["rpp_grad"])
    df["premium"] = df["y_major"] - np.log(df["rpp_grad"] / 100.0)
    rng = np.random.default_rng(RANDOM_SEED)
    parts = [
        _rank_group(g, rng)
        for _, g in df.groupby(["credential", "CIPCODE"])
        if g["UNITID"].nunique() >= MAJOR_MIN_SCHOOLS
    ]
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
