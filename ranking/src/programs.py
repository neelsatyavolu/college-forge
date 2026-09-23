"""Program-level earnings premiums (v3).

A program is one school × 4-digit CIP × credential (bachelor's or master's).
Its premium is log(school median / national median for the same major and
credential), from 4-year earnings, else 5-year earnings mapped onto the 4-year
scale (fit_horizon_shift, validated in src/backtest.py).

Estimates are shrunk in proportion to their noise with a two-level model chosen by
an out-of-sample backtest (src/backtest.py): a program's next graduating class is
predicted best by pooling it with the same school's other programs.

- School effect (overall ranking): a school's programs are pooled into one effect,
  shrunk toward a price-aware prior (α + β·ln(RPP/100)) by how little data it has.
- Program estimate (per-major ranking): the program's own result, shrunk toward its
  school effect by how noisy it is (b = ω² / (ω² + k·se²)).

σ (within-program log-earnings SD) and k (shrinkage multiplier) are calibrated and
selected by the backtest and pinned in config.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from config import (
    FOS_CSV,
    LOG_EARNINGS_SD,
    MIN_PROGRAM_VARIANCE,
    PROGRAM_FLOOR_SD,
    SHRINK_K,
)
from dollars import to_reference_dollars
from util import to_num

HORIZONS = {"1yr": "1YR", "4yr": "4YR", "5yr": "5YR"}
CREDENTIALS = {3: "bachelors", 5: "masters"}


def _weighted_median(values: pd.Series, weights: pd.Series) -> float:
    ok = values.notna() & weights.notna() & (weights > 0)
    if not ok.any():
        return np.nan
    v = values[ok].to_numpy(dtype=float)
    w = weights[ok].to_numpy(dtype=float)
    order = np.argsort(v)
    cw = np.cumsum(w[order])
    return float(v[order][np.searchsorted(cw, cw[-1] / 2.0)])


def program_group(df: pd.DataFrame) -> pd.Series:
    """
    Stable institution key across releases: zero-padded OPEID6 ("001081"), else the UNITID.
    Releases may store OPEID6 as text or number, and may pick a different campus to carry
    a branch group's cells, so programs are matched on this key, not on UNITID.
    """
    op = pd.to_numeric(df["OPEID6"], errors="coerce")
    key = op.map(lambda v: f"{int(v):06d}" if pd.notna(v) else None)
    return key.fillna("unit-" + df["UNITID"].astype("Int64").astype(str)).rename("group")


def collapse_branch_campuses(df: pd.DataFrame) -> pd.DataFrame:
    """
    Scorecard publishes field-of-study earnings per OPEID6, so branch campuses repeat
    their parent's cells. Keep one program per OPEID6 × major × credential, credited
    to the main campus (else the largest campus), with completions summed.
    """
    keys = ["group", "CIPCODE", "CREDLEV"]
    df = df.assign(group=program_group(df), MAIN=df["MAIN"].fillna(0))
    ranked = df.sort_values(["MAIN", "completions"], ascending=False, na_position="last")
    rep = ranked.drop_duplicates(keys).set_index(keys)
    rep["completions"] = df.groupby(keys)["completions"].sum(min_count=1)
    return rep.reset_index()


def load_programs() -> pd.DataFrame:
    """All bachelor's and master's programs, with national baselines per horizon."""
    cols = ["UNITID", "OPEID6", "INSTNM", "CONTROL", "MAIN", "CIPCODE", "CIPDESC", "CREDLEV",
            "IPEDSCOUNT1", "IPEDSCOUNT2", "EARN_MDN_4YR_NAT"]
    for h in HORIZONS.values():
        cols += [f"EARN_MDN_{h}", f"EARN_COUNT_WNE_{h}"]
    df = pd.read_csv(FOS_CSV, usecols=cols, low_memory=False)
    df = df[df["CREDLEV"].isin(CREDENTIALS)].copy()
    for c in cols[7:]:
        df[c] = to_num(df[c])
    df = to_reference_dollars(df, [f"EARN_MDN_{h}" for h in HORIZONS.values()] + ["EARN_MDN_4YR_NAT"])
    df["credential"] = df["CREDLEV"].map(CREDENTIALS)
    df["CIPCODE"] = df["CIPCODE"].astype(str).str.replace(r"\.0$", "", regex=True).str.zfill(4)
    df["CIPDESC"] = df["CIPDESC"].astype(str).str.strip().str.rstrip(".")
    # Unknown completions stay unknown (NaN), so coverage denominators are not distorted.
    df["completions"] = df[["IPEDSCOUNT1", "IPEDSCOUNT2"]].mean(axis=1)
    df = collapse_branch_campuses(df)

    # National medians (all institutions, incl. for-profit) per major × credential × horizon.
    # Scorecard publishes the 4-year one; 1- and 5-year are earner-weighted medians of cells.
    keys = ["CIPCODE", "CREDLEV"]
    for label, h in HORIZONS.items():
        nat = df.groupby(keys).apply(
            lambda g, h=h: _weighted_median(g[f"EARN_MDN_{h}"], g[f"EARN_COUNT_WNE_{h}"]),
            include_groups=False,
        ).rename(f"nat_{label}")
        df = df.merge(nat, left_on=keys, right_index=True, how="left")
    df["nat_4yr"] = df["EARN_MDN_4YR_NAT"].fillna(df["nat_4yr"])
    return df


def shrinkage_sd(df: pd.DataFrame) -> pd.Series:
    """Per-row σ·√k: calibrated within-program SD scaled by the backtest-selected k."""
    sigma = df["credential"].map(LOG_EARNINGS_SD)
    return sigma * np.sqrt(df["credential"].map(SHRINK_K))


MODELED_HORIZONS = ("4yr", "5yr")  # in order of preference; 1-year is shown, never scored
SHIFT_LEVELS = ("none", "credential", "major")


@dataclass(frozen=True)
class HorizonShift:
    """
    Fitted mapping from a 5-year premium onto the 4-year scale: y4 ≈ y5 − shift.
    by_major: (credential, CIPCODE) → shift, shift_var (posterior variance of the true
    shift), n_matched. by_credential: credential → (mean shift, between-major variance T²),
    used for majors with no matched programs.
    """
    level: str
    by_major: pd.DataFrame
    by_credential: dict[str, tuple[float, float]]

    def lookup(self, credential: pd.Series, cip: pd.Series) -> tuple[pd.Series, pd.Series]:
        if self.level == "none":
            zero = pd.Series(0.0, index=credential.index)
            return zero, zero
        keys = pd.MultiIndex.from_arrays([credential, cip])
        m = self.by_major.reindex(keys)
        mean = credential.map({c: v[0] for c, v in self.by_credential.items()})
        between = credential.map({c: v[1] for c, v in self.by_credential.items()})
        shift = pd.Series(m["shift"].to_numpy(dtype=float), index=credential.index).fillna(mean)
        var = pd.Series(m["shift_var"].to_numpy(dtype=float), index=credential.index).fillna(between)
        return shift.fillna(0.0), var.fillna(0.0)


def horizon_pairs(df: pd.DataFrame) -> pd.DataFrame:
    """Programs publishing both horizons: y4, y5 (log premiums vs each horizon's baseline) and counts."""
    y4 = np.log(df["EARN_MDN_4YR"] / df["nat_4yr"])
    y5 = np.log(df["EARN_MDN_5YR"] / df["nat_5yr"])
    d = df.assign(y4=y4, y5=y5, n4=df["EARN_COUNT_WNE_4YR"], n5=df["EARN_COUNT_WNE_5YR"])
    d = d.replace([np.inf, -np.inf], np.nan).dropna(subset=["y4", "y5", "n4", "n5"])
    return d[(d["n4"] > 0) & (d["n5"] > 0)].assign(diff=lambda x: x["y5"] - x["y4"])


def fit_horizon_shift(df: pd.DataFrame, level: str = "major") -> HorizonShift:
    """
    Fit the 5-year → 4-year mapping on programs that publish both horizons (equal weight
    per program). "major": each major's mean y5 − y4, shrunk by empirical Bayes toward the
    credential mean (T² = var of major means − their mean sampling variance, from the
    observed spread of differences, so program heterogeneity is included). "credential":
    one mean per credential. "none": no correction. Fit once, then apply frozen.
    """
    if level not in SHIFT_LEVELS:
        raise ValueError(f"unknown shift level {level!r}")
    rows, by_cred = [], {}
    for cred, g in horizon_pairs(df).groupby("credential"):
        maj = g.groupby("CIPCODE")["diff"].agg(["mean", "var", "size"])
        maj["v"] = (maj["var"].fillna(g["diff"].var()) / maj["size"]).where(maj["size"] > 1, g["diff"].var())
        mu = float(g["diff"].mean())
        t2 = float(max(np.average((maj["mean"] - mu) ** 2, weights=maj["size"]) - np.average(maj["v"], weights=maj["size"]), 0.0))
        if level == "credential":
            by_cred[cred] = (mu, float(g["diff"].var() / len(g)))
            continue
        b = t2 / (t2 + maj["v"]) if t2 > 0 else 0.0 * maj["v"]
        rows.append(pd.DataFrame({
            "credential": cred, "CIPCODE": maj.index,
            "shift": mu + b * (maj["mean"] - mu), "shift_var": b * maj["v"], "n_matched": maj["size"],
        }))
        by_cred[cred] = (mu, t2)
    cols = ["credential", "CIPCODE", "shift", "shift_var", "n_matched"]
    by_major = pd.concat(rows, ignore_index=True) if rows else pd.DataFrame(columns=cols)
    return HorizonShift(level, by_major.set_index(["credential", "CIPCODE"]), by_cred)


def program_premiums(df: pd.DataFrame, log_sd: float | pd.Series, shift: HorizonShift | None) -> pd.DataFrame:
    """
    Raw log premium and sampling variance per program from ONE horizon: 4-year earnings,
    else 5-year. This is the observation model the backtest validates. Pooling horizons
    would treat overlapping cohorts as independent, and 1-year earnings (partly pandemic
    years, overlapping the next cohort) are displayed only.
    A 5-year premium is put on the 4-year scale with the frozen `shift` mapping (None = no
    correction); the mapping's uncertainty is added to its variance.
    log_sd: effective log-earnings SD, a scalar or one value per row.
    """
    out = df.copy()
    out["y_raw"] = np.nan
    out["se2"] = np.nan
    out["earnings_display"] = np.nan
    out["earnings_horizon"] = ""
    out["earners"] = np.nan
    out["horizon_shift"] = 0.0
    if shift is None:
        delta = var = pd.Series(0.0, index=df.index)
    else:
        delta, var = shift.lookup(df["credential"], df["CIPCODE"])
    for label in reversed(MODELED_HORIZONS):  # later assignments win: 4-year preferred
        h = HORIZONS[label]
        e, n, nat = df[f"EARN_MDN_{h}"], df[f"EARN_COUNT_WNE_{h}"], df[f"nat_{label}"]
        ok = e.notna() & n.notna() & nat.notna() & (e > 0) & (nat > 0)
        # SE of a median ≈ 1.2533·σ/√n
        se2 = pd.Series((1.2533 * log_sd) ** 2 / n.clip(lower=10), index=df.index)
        adj = delta if label == "5yr" else 0.0 * delta
        extra = var if label == "5yr" else 0.0 * var
        out.loc[ok, "y_raw"] = (np.log(e / nat) - adj)[ok]
        out.loc[ok, "se2"] = (se2 + extra)[ok]
        out.loc[ok, "horizon_shift"] = adj[ok]
        out.loc[ok, "earnings_display"] = e[ok]
        out.loc[ok, "earnings_horizon"] = label
        out.loc[ok, "earners"] = n[ok]
    return out


Prior = dict[str, tuple[float, float]]  # credential → (α, β)


def _floored(v: float) -> float:
    """Variance component with a floor; NaN (e.g. no multi-program schools) → floor.
    Plain max() would return NaN, since NaN comparisons are always False."""
    return float(v) if np.isfinite(v) and v > MIN_PROGRAM_VARIANCE else MIN_PROGRAM_VARIANCE


def price_prior(progs: pd.DataFrame, log_price: pd.Series) -> Prior:
    """
    Per credential: nominal premium ≈ α + β·ln(RPP/100), precision-weighted.
    α is the typical premium of ranked (public/nonprofit) programs at the national price
    level; it need not be 0, since national medians include every institution.
    """
    x = progs["UNITID"].map(log_price).fillna(0.0)
    df = progs.assign(x=x).dropna(subset=["y_raw"])
    out: Prior = {}
    for cred, g in df.groupby("credential"):
        w = 1.0 / (g["se2"] + MIN_PROGRAM_VARIANCE * 10)
        xm = np.average(g["x"], weights=w)
        ym = np.average(g["y_raw"], weights=w)
        sxx = float((w * (g["x"] - xm) ** 2).sum())
        beta = float((w * (g["x"] - xm) * (g["y_raw"] - ym)).sum() / sxx) if sxx > 0 else 0.0
        out[cred] = (float(ym - beta * xm), beta)
    return out


def _prior_mean(cred: str, unitids: pd.Series | pd.Index, log_price: pd.Series, prior: Prior) -> np.ndarray:
    alpha, beta = prior[cred]
    x = pd.Series(unitids).map(log_price).fillna(0.0).to_numpy()
    return alpha + beta * x


def school_effects(progs: pd.DataFrame, log_price: pd.Series, prior: Prior) -> tuple[pd.DataFrame, dict]:
    """
    School effect per credential (two-level empirical Bayes), nominal log premium.

    y_pj = μ_j + ε_pj + e_pj ;  ε ~ N(0, ω²) program deviation ; e ~ N(0, se²) sampling
    μ_j ~ N(α + β·ln(RPP_j/100), τ²).
    Returns schools with mu_hat, mu_sd and mu_price_loading (∂μ̂/∂ln RPP = (1−b)·β),
    plus diagnostics.
    """
    parts, diag = [], {}
    for cred, g in progs.dropna(subset=["y_raw"]).groupby("credential"):
        k = g.groupby("UNITID")["y_raw"].transform("size")
        dev = g["y_raw"] - g.groupby("UNITID")["y_raw"].transform("mean")
        multi = k > 1
        omega2 = _floored((dev[multi] ** 2 * k[multi] / (k[multi] - 1)).mean() - g.loc[multi, "se2"].mean())
        g = g.assign(w=1.0 / (omega2 + g["se2"]))
        sch = g.groupby("UNITID").apply(
            lambda d: pd.Series({
                "m": np.average(d["y_raw"], weights=d["w"]),
                "var_m": 1.0 / d["w"].sum(),
                "n_programs": len(d),
            }),
            include_groups=False,
        )
        m0 = pd.Series(_prior_mean(cred, sch.index, log_price, prior), index=sch.index)
        tau2 = _floored((sch["m"] - m0).var() - sch["var_m"].mean())
        b = tau2 / (tau2 + sch["var_m"])
        sch["mu_hat"] = m0 + b * (sch["m"] - m0)
        sch["mu_sd"] = np.sqrt(b * sch["var_m"])
        sch["mu_price_loading"] = (1 - b) * prior[cred][1]
        sch["credential"] = cred
        parts.append(sch.reset_index())
        diag[cred] = {"omega": float(np.sqrt(omega2)), "tau": float(np.sqrt(tau2)),
                      "alpha": prior[cred][0], "beta": prior[cred][1],
                      "programs": int(len(g)), "schools": int(len(sch))}
    return pd.concat(parts, ignore_index=True), diag


def program_estimates(
    progs: pd.DataFrame, schools: pd.DataFrame, diag: dict, floor_sd: dict[str, float] | None = None
) -> pd.DataFrame:
    """
    Per-major program estimate (backtest-selected): the program's own premium shrunk
    toward its school effect, b = ω² / (ω² + se²). Adds y_program, y_program_sd and
    price_loading (∂estimate/∂ln RPP = (1−b)·(school price loading)).
    y_program_sd includes the count-independent floor (config PROGRAM_FLOOR_SD unless
    floor_sd is given; the backtest passes zeros and adds its own calibrated floor once).
    """
    sch = schools[["UNITID", "credential", "mu_hat", "mu_sd", "mu_price_loading"]]
    out = progs.merge(sch, on=["UNITID", "credential"], how="left")
    omega2 = out["credential"].map({c: d["omega"] ** 2 for c, d in diag.items()})
    b = omega2 / (omega2 + out["se2"])
    out["y_program"] = out["mu_hat"] + b * (out["y_raw"] - out["mu_hat"])
    floor2 = out["credential"].map(PROGRAM_FLOOR_SD if floor_sd is None else floor_sd).fillna(0.0) ** 2
    out["y_program_sd"] = np.sqrt(b * out["se2"] + (1 - b) ** 2 * out["mu_sd"] ** 2 + floor2)
    out["price_loading"] = (1 - b) * out["mu_price_loading"]
    return out


def major_estimates(
    progs: pd.DataFrame, log_price: pd.Series, prior: Prior, min_programs: int = 20
) -> pd.DataFrame:
    """
    Backtest challenger (not used for published ranks): shrink each program toward the
    price-aware prior only, by b = τ_m² / (τ_m² + se²) with τ_m the spread within its
    major. It lost to program_estimates on next-cohort prediction (out/backtest.json).
    """
    out = progs.copy()
    out["prior"] = np.nan
    for cred in out["credential"].dropna().unique():
        rows = out["credential"] == cred
        out.loc[rows, "prior"] = _prior_mean(cred, out.loc[rows, "UNITID"], log_price, prior)
    out["resid"] = out["y_raw"] - out["prior"]
    keys = ["credential", "CIPCODE"]
    g = out[out["resid"].notna()].groupby(keys)
    tau2 = (g["resid"].var() - g["se2"].mean()).clip(lower=MIN_PROGRAM_VARIANCE)
    enough = g.size() >= min_programs
    fallback = tau2[enough].groupby(level="credential").median()
    tau2 = tau2.where(enough, tau2.index.get_level_values("credential").map(fallback).to_numpy())
    out = out.merge(pd.Series(tau2, name="tau2_major").reset_index(), on=keys, how="left")
    b = out["tau2_major"] / (out["tau2_major"] + out["se2"])
    out["y_major"] = out["prior"] + b * out["resid"]
    out["y_major_sd"] = np.sqrt(b * out["se2"])
    return out.drop(columns=["resid"])


def expected_earnings(progs: pd.DataFrame, horizon: str = "5yr") -> pd.Series:
    """Completion-weighted national median for each school's bachelor's major mix."""
    b = progs[(progs["credential"] == "bachelors") & (progs["completions"].fillna(0) > 0)]
    nat = b[f"nat_{horizon}"].fillna(b["nat_4yr"])
    ok = nat.notna()
    b = b.assign(wx=b["completions"] * nat)[ok]
    g = b.groupby("UNITID")
    return (g["wx"].sum() / g["completions"].sum()).rename("expected_earnings")
