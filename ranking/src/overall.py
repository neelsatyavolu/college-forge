"""Overall career-outcomes score (§4), rank intervals (§6), beats-expectations view (§7)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from config import (
    COVERAGE_FLOOR,
    LOG_EARNINGS_SD,
    N_BOOT,
    OVERALL_WEIGHTS,
    RANDOM_SEED,
    REQUIRED_COMPONENTS,
    Z_CLIP,
)
from util import crossfit_residuals

COMPONENTS = list(OVERALL_WEIGHTS)


def components(
    schools: pd.DataFrame,
    school_effects: pd.DataFrame,
    expected: pd.Series,
    rpp: pd.DataFrame,
) -> pd.DataFrame:
    """
    One row per eligible school (UNITID index) with the four scored components.
    Premiums are log ratios, so +0.10 ≈ 10.5% more than the comparison.
    """
    df = schools.set_index("UNITID")
    bach = school_effects[school_effects["credential"] == "bachelors"].set_index("UNITID")
    col = np.log(rpp["rpp_grad"].reindex(df.index) / 100.0)
    out = pd.DataFrame(index=df.index)
    out["early_premium"] = bach["mu_hat"].reindex(df.index) - col
    out["early_premium_sd"] = bach["mu_sd"].reindex(df.index)
    out["long_premium"] = np.log(df["MD_EARN_WNE_P10"]) - col - np.log(expected.reindex(df.index))
    out["long_premium_sd"] = 1.2533 * LOG_EARNINGS_SD / np.sqrt(df["COUNT_WNE_P10"].clip(lower=10))
    out["graduation"] = df["C150_4"]
    out["employment"] = df["employment_rate"]
    out["col_sd"] = rpp["rpp_log_sd"].reindex(df.index).fillna(0.0) if "rpp_log_sd" in rpp else 0.0
    return out


def zscore(s: pd.Series, ref: pd.Series | None = None) -> pd.Series:
    ref = s if ref is None else ref
    return ((s - ref.mean()) / ref.std(ddof=0)).clip(-Z_CLIP, Z_CLIP)


def composite(comp: pd.DataFrame, ref: pd.DataFrame | None = None, weights: dict | None = None) -> pd.Series:
    """Weighted mean of z-scores, renormalized over the components a school has."""
    w = weights or OVERALL_WEIGHTS
    ref = comp if ref is None else ref
    num = pd.Series(0.0, index=comp.index)
    den = pd.Series(0.0, index=comp.index)
    for c, wc in w.items():
        z = zscore(comp[c], ref[c])
        num = num + z.fillna(0) * wc
        den = den + z.notna() * wc
    score = num / den.replace(0, np.nan)
    return score.where(comp[list(REQUIRED_COMPONENTS)].notna().all(axis=1))


def coverage(programs: pd.DataFrame) -> pd.Series:
    """Share of bachelor's completions in programs with published earnings."""
    b = programs[programs["credential"] == "bachelors"]
    total = b.groupby("UNITID")["completions"].sum()
    covered = b[b["y_raw"].notna()].groupby("UNITID")["completions"].sum()
    return (covered.reindex(total.index).fillna(0) / total.replace(0, np.nan)).rename("coverage")


def score_table(comp: pd.DataFrame) -> pd.DataFrame:
    df = comp.copy()
    df["composite"] = composite(df)
    df = df.dropna(subset=["composite"])
    lo, hi = df["composite"].min(), df["composite"].max()
    df["score"] = 100.0 * (df["composite"] - lo) / (hi - lo)
    df = df.sort_values(["composite", "early_premium"], ascending=False)
    df["rank"] = np.arange(1, len(df) + 1)
    return df


def rank_intervals(table: pd.DataFrame, n_boot: int = N_BOOT, seed: int = RANDOM_SEED) -> pd.DataFrame:
    """
    5th–95th percentile ranks when earnings estimates and the modeled graduate price
    level are redrawn from their uncertainty (the price error shifts both earnings
    components together). Conditional on this model; weights, the price basket and
    other specification choices are covered by sensitivity(), not by these ranges.
    """
    rng = np.random.default_rng(seed)
    base = table[COMPONENTS]
    col_sd = table["col_sd"].fillna(0).to_numpy() if "col_sd" in table else np.zeros(len(table))
    ranks = np.empty((n_boot, len(table)), dtype=np.int32)
    for b in range(n_boot):
        draw = base.copy()
        price_err = rng.normal(0.0, 1.0, len(base)) * col_sd
        for c in ("early_premium", "long_premium"):
            sd = table[f"{c}_sd"].fillna(0).to_numpy()
            draw[c] = base[c] + rng.normal(0.0, 1.0, len(base)) * sd - price_err
        c = composite(draw, ref=base).to_numpy()
        order = np.argsort(-c)
        rk = np.empty(len(c), dtype=np.int32)
        rk[order] = np.arange(1, len(c) + 1)
        ranks[b] = rk
    return pd.DataFrame(
        {"rank_low": np.percentile(ranks, 5, axis=0).round().astype(int),
         "rank_high": np.percentile(ranks, 95, axis=0).round().astype(int)},
        index=table.index,
    )


def beats_expectations(table: pd.DataFrame, schools: pd.DataFrame) -> pd.Series:
    """
    §7: score minus the score a student-profile model predicts (SAT/ACT, admit rate,
    Pell, first-gen), in score points. Predictions are cross-fitted, so no school's own
    outcome shapes its prediction. Descriptive, not a causal value-added estimate.
    """
    s = schools.set_index("UNITID").reindex(table.index)
    sat = s["SAT_AVG"].fillna(s["ACTCMMID"] * 40 + 200)  # concordance-style ACT→SAT
    X = pd.DataFrame({
        "sat": sat.fillna(sat.median()),
        "sat_missing": sat.isna().astype(float),
        "adm": s["ADM_RATE"].fillna(s["ADM_RATE"].median()),
        "pell": s["PCTPELL"],
        "first_gen": s["FIRST_GEN"].fillna(s["FIRST_GEN"].median()),
    }, index=table.index)
    return crossfit_residuals(table["score"], X).rename("beats_expectations")


def sensitivity(
    comp: pd.DataFrame,
    headline: pd.Series,
    alt_components: dict[str, pd.DataFrame],
) -> pd.DataFrame:
    """How much the ranking moves under reasonable alternative choices."""
    variants = {
        "equal_weights": (comp, {c: 0.25 for c in COMPONENTS}),
        "earnings_only": (comp, {"early_premium": 2 / 3, "long_premium": 1 / 3}),
        "early_earnings_only": (comp, {"early_premium": 1.0}),
        "no_graduation": (comp, {k: v for k, v in OVERALL_WEIGHTS.items() if k != "graduation"}),
        "no_employment": (comp, {k: v for k, v in OVERALL_WEIGHTS.items() if k != "employment"}),
        **{name: (alt, OVERALL_WEIGHTS) for name, alt in alt_components.items()},
    }
    rows = []
    top = set(headline.nsmallest(25).index)
    for name, (data, w) in variants.items():
        rk = composite(data.reindex(headline.index), weights=w).rank(ascending=False, method="min")
        rows.append({
            "variant": name,
            "spearman_vs_headline": float(headline.corr(rk, method="spearman")),
            "top25_overlap": len(top & set(rk.nsmallest(25).index)),
        })
    return pd.DataFrame(rows)


def eligible_for_scoring(comp: pd.DataFrame, cov: pd.Series) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Drop schools whose earnings describe too few graduates or that lack a required component."""
    c = cov.reindex(comp.index).fillna(0)
    rules = [(c < COVERAGE_FLOOR, f"earnings_coverage_below_{COVERAGE_FLOOR:.2f}", "coverage", c.round(3))]
    for col in REQUIRED_COMPONENTS:
        rules.append((comp[col].isna(), f"missing_{col}", col, comp[col]))
    keep = pd.Series(True, index=comp.index)
    parts = []
    for mask, reason, field, value in rules:
        hit = mask & keep
        parts.append(pd.DataFrame({
            "UNITID": comp.index[hit], "reason": reason, "field": field,
            "failing_value": value[hit].astype(str).values,
        }))
        keep = keep & ~mask
    return comp.loc[keep].assign(coverage=c[keep]), pd.concat(parts, ignore_index=True)
