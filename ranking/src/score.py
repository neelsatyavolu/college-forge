"""Composite score, bootstrap intervals, value-added, sensitivity (§6–8, §12)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from config import (
    COMPOSITE_REP_W,
    COMPOSITE_VALUE_W,
    N_BOOT,
    RANDOM_SEED,
    REP_RESIDUALIZE_THRESHOLD,
    REP_WEIGHTS,
)
from util import ols_residuals, pctile_rank, pearson, spearman, top_n_churn


def value_metric(earnings: pd.Series, rpp_grad: pd.Series) -> pd.Series:
    return (earnings / (rpp_grad / 100.0)).rename("value_metric")


def build_composite(
    value: pd.Series,
    reputation: pd.Series,
    residualize: bool | None = None,
) -> tuple[pd.Series, pd.Series, pd.Series, dict]:
    """
    Returns composite (0-100), value_pctile, rep_pctile, diagnostics.
    residualize=None → auto by correlation test.
    """
    v_pct = pctile_rank(value)
    r_raw = reputation
    r_pear = pearson(v_pct, pctile_rank(r_raw) if r_raw.max() > 1.5 else r_raw)
    r_spear = spearman(v_pct, pctile_rank(r_raw) if r_raw.max() > 1.5 else r_raw)

    used_residual = False
    rep_for_score = r_raw
    if residualize is True or (residualize is None and abs(r_pear) >= REP_RESIDUALIZE_THRESHOLD):
        # residualize reputation on value
        resid = ols_residuals(pctile_rank(r_raw).fillna(pctile_rank(r_raw).median()), pd.DataFrame({"v": v_pct}))
        rep_for_score = resid
        used_residual = True

    r_pct = pctile_rank(rep_for_score)
    composite = COMPOSITE_VALUE_W * v_pct + COMPOSITE_REP_W * r_pct
    diag = {
        "pearson_value_rep": r_pear,
        "spearman_value_rep": r_spear,
        "residualized_reputation": used_residual,
    }
    return composite.rename("composite_score"), v_pct.rename("value_pctile"), r_pct.rename("reputation_pctile"), diag


def rank_with_ties(composite: pd.Series, value: pd.Series) -> pd.Series:
    """Rank 1 = best; ties broken by value metric."""
    df = pd.DataFrame({"c": composite, "v": value})
    # higher composite better; higher value better as tiebreak
    return (
        df.sort_values(["c", "v"], ascending=[False, False])
        .assign(rank=lambda d: np.arange(1, len(d) + 1))
        ["rank"]
        .reindex(df.index)
    )


def bootstrap_ranks(
    earnings: pd.Series,
    rpp_grad: pd.Series,
    reputation: pd.Series,
    earn_n: pd.Series | None = None,
    n_boot: int = N_BOOT,
    seed: int = RANDOM_SEED,
    residualize: bool = False,
) -> pd.DataFrame:
    """
    Resample earnings with Gaussian noise ~ se = earnings * 0.15 / sqrt(n),
    recompute composite ranks; return rank_low/rank_high (5th–95th pctile).
    """
    rng = np.random.default_rng(seed)
    idx = earnings.dropna().index
    e0 = earnings.loc[idx].to_numpy(dtype=float)
    rpp = rpp_grad.reindex(idx).fillna(100).to_numpy(dtype=float)
    rep = reputation.reindex(idx).fillna(reputation.median()).to_numpy(dtype=float)
    if earn_n is not None:
        n = earn_n.reindex(idx).fillna(50).clip(lower=10).to_numpy(dtype=float)
    else:
        n = np.full(len(idx), 50.0)
    se = e0 * 0.12 / np.sqrt(n)

    ranks = np.zeros((n_boot, len(idx)), dtype=np.int32)
    for b in range(n_boot):
        e = np.clip(rng.normal(e0, se), 1_000, None)
        v = e / (rpp / 100.0)
        # percentile ranks
        v_pct = pd.Series(v).rank(pct=True).to_numpy() * 100
        r_pct = pd.Series(rep).rank(pct=True).to_numpy() * 100
        if residualize:
            # quick residualization
            X = np.column_stack([np.ones(len(v_pct)), v_pct])
            beta, *_ = np.linalg.lstsq(X, r_pct, rcond=None)
            r_pct = r_pct - X @ beta
            r_pct = pd.Series(r_pct).rank(pct=True).to_numpy() * 100
        comp = COMPOSITE_VALUE_W * v_pct + COMPOSITE_REP_W * r_pct
        # rank
        order = np.argsort(-comp)
        rk = np.empty(len(idx), dtype=np.int32)
        rk[order] = np.arange(1, len(idx) + 1)
        ranks[b] = rk

    low = np.percentile(ranks, 5, axis=0)
    high = np.percentile(ranks, 95, axis=0)
    return pd.DataFrame(
        {"rank_low": low, "rank_high": high},
        index=idx,
    )


def value_added_residual(value: pd.Series, inst: pd.DataFrame) -> pd.Series:
    """§7: residual of V on admissions/student characteristics."""
    X = pd.DataFrame({
        "sat": to_num_safe(inst.get("SAT_AVG")),
        "act": to_num_safe(inst.get("ACTCMMID")),
        "pell": to_num_safe(inst.get("PCTPELL")),
        "first_gen": to_num_safe(inst.get("FIRST_GEN")),
        "adm": to_num_safe(inst.get("ADM_RATE")),
        "region": to_num_safe(inst.get("REGION")),
    }, index=inst.index if inst.index.equals(value.index) else value.index)
    # Align
    X = X.reindex(value.index)
    # Prefer SAT; if missing use ACT scaled
    X["sat"] = X["sat"].fillna(X["act"] * 40 + 200)  # rough ACT→SAT
    X = X.drop(columns=["act"])
    return ols_residuals(value, X).rename("value_added")


def to_num_safe(s):
    if s is None:
        return pd.Series(dtype=float)
    return pd.to_numeric(s, errors="coerce")


def sensitivity_table(base: pd.DataFrame, variants: dict[str, pd.Series]) -> pd.DataFrame:
    """
    base must have UNITID index and rank column.
    variants: name → composite or value series to re-rank.
    """
    rows = []
    base_rank = base["rank"]
    for name, series in variants.items():
        rk = series.rank(ascending=False, method="min")
        rows.append({
            "variant": name,
            "spearman_vs_headline": spearman(base_rank, rk),
            "top25_churn": top_n_churn(base_rank, rk, 25),
            "n": int(series.notna().sum()),
        })
    return pd.DataFrame(rows)


def per_major_ranking(
    scored_cips: pd.DataFrame,
    rpp_grad_by_unit: pd.Series,
    institution_rank: pd.Series,
    min_schools: int = 25,
) -> pd.DataFrame:
    """§12: rank schools within each 4-digit CIP on value metric only."""
    df = scored_cips.copy()
    df["rpp_grad_cip"] = df["UNITID"].map(rpp_grad_by_unit)
    df["rpp_source"] = "modeled"  # institution-level RPP_grad (CIP-level PSEO not wired in v1)
    # If we later add CIP-level PSEO, flag pseo_cip
    df["value_metric_cip"] = df["earnings_4yr"] / (df["rpp_grad_cip"] / 100.0)
    df["cip_family"] = df["CIPCODE"].astype(str).str[:2]
    df["institution_rank"] = df["UNITID"].map(institution_rank)

    parts = []
    for cip, g in df.groupby("CIPCODE"):
        if g["UNITID"].nunique() < min_schools:
            continue
        g = g.sort_values("value_metric_cip", ascending=False).copy()
        g["rank_in_major"] = np.arange(1, len(g) + 1)
        # rough bootstrap interval: rank ± based on n
        se_rank = np.maximum(1, np.sqrt(g["earn_n"].fillna(30).clip(lower=10)) * 0.3)
        g["rank_low"] = (g["rank_in_major"] - 1.96 * se_rank).clip(lower=1).round().astype(int)
        g["rank_high"] = (g["rank_in_major"] + 1.96 * se_rank).clip(upper=len(g)).round().astype(int)
        parts.append(g)

    if not parts:
        return pd.DataFrame()
    out = pd.concat(parts, ignore_index=True)
    out = out.rename(columns={
        "CIPCODE": "cip_code",
        "CIPDESC": "cip_desc",
        "earnings_4yr": "earnings_cip",
        "completions": "completions",
        "INSTNM": "institution",
    })
    cols = [
        "cip_code", "cip_desc", "cip_family", "UNITID", "institution", "STABBR",
        "rank_in_major", "rank_low", "rank_high",
        "earnings_cip", "rpp_grad_cip", "value_metric_cip", "rpp_source",
        "completions", "institution_rank",
    ]
    # STABBR may be missing on fos rows
    if "STABBR" not in out.columns:
        out["STABBR"] = ""
    if "institution" not in out.columns and "INSTNM" in out.columns:
        out["institution"] = out["INSTNM"]
    return out[[c for c in cols if c in out.columns]]
