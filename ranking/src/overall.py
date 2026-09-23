"""Overall career-outcomes score (§6), rank intervals (§9), beats-expectations view (§8)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from config import (
    COVERAGE_FLOOR,
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
    price_weight: float,
) -> pd.DataFrame:
    """
    One row per eligible school (UNITID index). Premiums are log ratios (+0.10 ≈ +10.5%).

    price_weight w subtracts w·ln(graduate price level): 0 = as reported (with the flat-prior
    effects), 0.5 = the page default, 1 = full purchasing power. The price level also enters
    the shrinkage prior of the price-aware effects, so a price error ε moves the early
    premium by price_coef·ε = (loading − w)·ε.
    """
    df = schools.set_index("UNITID")
    bach = school_effects[school_effects["credential"] == "bachelors"].set_index("UNITID").reindex(df.index)
    col = price_weight * np.log(rpp["rpp_grad"].reindex(df.index) / 100.0)
    out = pd.DataFrame(index=df.index)
    out["early_premium"] = bach["mu_hat"] - col
    out["early_premium_sd"] = bach["mu_sd"]
    out["price_sd"] = rpp["rpp_log_sd"].reindex(df.index).fillna(0.0)
    out["price_coef"] = bach["mu_price_loading"].fillna(0.0) - price_weight
    # Displayed only (v3.0): entrants incl. non-completers vs a completer baseline.
    out["later_premium"] = np.log(df["MD_EARN_WNE_P10"]) - col - np.log(expected.reindex(df.index))
    out["graduation"] = df["C150_4"]
    out["employment"] = df["employment_rate"]
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
    """Share of bachelor's completions (where known) in programs with published earnings."""
    b = programs[(programs["credential"] == "bachelors") & programs["completions"].notna()]
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
    5th–95th percentile ranks when each school's earnings estimate and (where modeled)
    its graduate price level are redrawn from their uncertainty. Graduation and
    employment are fixed; specification choices are covered by sensitivity().
    """
    rng = np.random.default_rng(seed)
    base = table[COMPONENTS]
    sd = table["early_premium_sd"].fillna(0).to_numpy()
    price = (table["price_coef"] * table["price_sd"]).fillna(0).to_numpy()
    ranks = np.empty((n_boot, len(table)), dtype=np.int32)
    for b in range(n_boot):
        draw = base.copy()
        draw["early_premium"] = (
            base["early_premium"] + rng.normal(0.0, 1.0, len(base)) * sd + rng.normal(0.0, 1.0, len(base)) * price
        )
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


def beats_expectations(table: pd.DataFrame, schools: pd.DataFrame) -> tuple[pd.Series, dict]:
    """
    §8: headline score minus a 10-fold cross-fitted prediction from SAT/ACT, admit rate,
    Pell share and first-generation share, in score points. The regression is cross-fitted;
    the score's own normalization and a few median-filled predictors use the full universe.
    Descriptive, not a causal value-added estimate. Returns residuals and fit diagnostics.
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
    resid = crossfit_residuals(table["score"], X)
    y = table["score"][resid.notna()]
    fit = {
        "out_of_fold_r2": float(1 - (resid.dropna() ** 2).sum() / ((y - y.mean()) ** 2).sum()),
        "residual_sd_points": float(resid.std()),
        "n": int(resid.notna().sum()),
    }
    return resid.rename("beats_expectations"), fit


def sensitivity(
    comp: pd.DataFrame,
    headline: pd.Series,
    alternatives: dict[str, pd.DataFrame],
) -> pd.DataFrame:
    """How much the headline ranking moves under reasonable alternative choices."""
    variants = {
        "equal_weights": (comp, {c: 1 / len(COMPONENTS) for c in COMPONENTS}),
        "early_earnings_only": (comp, {"early_premium": 1.0}),
        "no_graduation": (comp, {k: v for k, v in OVERALL_WEIGHTS.items() if k != "graduation"}),
        "no_employment": (comp, {k: v for k, v in OVERALL_WEIGHTS.items() if k != "employment"}),
        **{name: (alt, OVERALL_WEIGHTS) for name, alt in alternatives.items()},
    }
    rows = []
    for name, (data, w) in variants.items():
        common = headline.index.intersection(data.dropna(subset=list(REQUIRED_COMPONENTS)).index)
        rk = composite(data.loc[common], weights=w).rank(ascending=False, method="min")
        base = headline.loc[common].rank(method="min")
        top = set(base.nsmallest(25).index)
        rows.append({
            "variant": name,
            "n_schools": int(len(common)),
            "spearman_vs_headline": float(base.corr(rk, method="spearman")),
            "top25_overlap": len(top & set(rk.nsmallest(25).index)),
            "median_rank_shift": float((base - rk).abs().median()),
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


def completion_weighted_effect(programs: pd.DataFrame) -> pd.Series:
    """Sensitivity: completion-weighted mean of program estimates (vs the pooled school effect)."""
    b = programs[(programs["credential"] == "bachelors") & programs["y_program"].notna()
                 & (programs["completions"].fillna(0) > 0)]
    g = b.assign(wx=b["y_program"] * b["completions"]).groupby("UNITID")
    return g["wx"].sum() / g["completions"].sum()

