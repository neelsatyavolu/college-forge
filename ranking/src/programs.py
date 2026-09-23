"""Program-level earnings premiums (v2).

A program is one school × 4-digit CIP × credential (bachelor's or master's).
Its premium is log(school median / national median for the same major and
credential), pooled across the 1-, 4- and 5-year horizons Scorecard publishes.

Small programs are noisy, so estimates are shrunk in proportion to their noise,
with a different target for each question:

- School effect (overall ranking): pool all of a school's programs, then shrink
  toward the national average by how much data the school has. Shrinking each
  program to the national mean first would erase strong schools whose programs
  are individually small.
- Program estimate (per-major ranking): shrink toward the national average for
  that major. A program earns its rank from its own graduates; it never inherits
  its school's strength in other majors.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from config import (
    FOS_CSV,
    HORIZON_SE_INFLATION,
    LOG_EARNINGS_SD,
    MIN_PROGRAM_VARIANCE,
)
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


def collapse_branch_campuses(df: pd.DataFrame) -> pd.DataFrame:
    """
    Scorecard publishes field-of-study earnings per OPEID6, so branch campuses repeat
    their parent's cells. Keep one program per OPEID6 × major × credential, credited
    to the main campus (else the largest campus), with completions summed.
    """
    keys = ["group", "CIPCODE", "CREDLEV"]
    df = df.assign(
        group=df["OPEID6"].astype("string").fillna("unit-" + df["UNITID"].astype(str)),
        MAIN=df["MAIN"].fillna(0),
    )
    ranked = df.sort_values(["MAIN", "completions"], ascending=False)
    rep = ranked.drop_duplicates(keys).set_index(keys)
    rep["completions"] = df.groupby(keys)["completions"].sum()
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
    df["credential"] = df["CREDLEV"].map(CREDENTIALS)
    df["CIPCODE"] = df["CIPCODE"].astype(str).str.replace(r"\.0$", "", regex=True).str.zfill(4)
    df["CIPDESC"] = df["CIPDESC"].astype(str).str.strip().str.rstrip(".")
    df["completions"] = df[["IPEDSCOUNT1", "IPEDSCOUNT2"]].mean(axis=1).fillna(0)
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


def program_premiums(df: pd.DataFrame) -> pd.DataFrame:
    """Raw log premium and sampling variance per program, pooled across horizons."""
    num = pd.Series(0.0, index=df.index)
    prec = pd.Series(0.0, index=df.index)
    for label, h in HORIZONS.items():
        e, n, nat = df[f"EARN_MDN_{h}"], df[f"EARN_COUNT_WNE_{h}"], df[f"nat_{label}"]
        ok = e.notna() & n.notna() & nat.notna() & (e > 0) & (nat > 0)
        # SE of a median ≈ 1.2533·σ/√n; 1-year earnings are noisier career signals.
        se2 = (1.2533 * LOG_EARNINGS_SD) ** 2 / n.clip(lower=10)
        if label == "1yr":
            se2 = se2 * HORIZON_SE_INFLATION
        y = np.log(e / nat)
        num = num + np.where(ok, y / se2, 0.0)
        prec = prec + np.where(ok, 1.0 / se2, 0.0)
    out = df.copy()
    has = prec > 0
    out["y_raw"] = np.where(has, num / prec.where(has, 1.0), np.nan)
    out["se2"] = np.where(has, 1.0 / prec.where(has, 1.0), np.nan)
    out["earnings_display"] = out["EARN_MDN_4YR"].fillna(out["EARN_MDN_5YR"]).fillna(out["EARN_MDN_1YR"])
    out["earnings_horizon"] = np.select(
        [out["EARN_MDN_4YR"].notna(), out["EARN_MDN_5YR"].notna(), out["EARN_MDN_1YR"].notna()],
        ["4yr", "5yr", "1yr"],
        default="",
    )
    out["earners"] = out[[f"EARN_COUNT_WNE_{h}" for h in HORIZONS.values()]].max(axis=1)
    return out


def school_effects(progs: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """
    School effect per credential (two-level empirical Bayes).

    y_pj = μ_j + ε_pj + e_pj ;  ε ~ N(0, ω²) program deviation ; e ~ N(0, se²) sampling
    μ_j ~ N(0, τ²) school effect. Returns schools with mu_hat/mu_sd, plus diagnostics.
    """
    parts, diag = [], {}
    for cred, g in progs.dropna(subset=["y_raw"]).groupby("credential"):
        k = g.groupby("UNITID")["y_raw"].transform("size")
        dev = g["y_raw"] - g.groupby("UNITID")["y_raw"].transform("mean")
        multi = k > 1
        omega2 = max(
            float((dev[multi] ** 2 * k[multi] / (k[multi] - 1)).mean() - g.loc[multi, "se2"].mean()),
            MIN_PROGRAM_VARIANCE,
        )
        g = g.assign(w=1.0 / (omega2 + g["se2"]))
        sch = g.groupby("UNITID").apply(
            lambda d: pd.Series({
                "m": np.average(d["y_raw"], weights=d["w"]),
                "var_m": 1.0 / d["w"].sum(),
                "n_programs": len(d),
            }),
            include_groups=False,
        )
        tau2 = max(float(sch["m"].var() - sch["var_m"].mean()), MIN_PROGRAM_VARIANCE)
        b = tau2 / (tau2 + sch["var_m"])
        sch["mu_hat"] = b * sch["m"]
        sch["mu_sd"] = np.sqrt(b * sch["var_m"])
        sch["credential"] = cred
        parts.append(sch.reset_index())
        diag[cred] = {"omega": float(np.sqrt(omega2)), "tau": float(np.sqrt(tau2)),
                      "programs": int(len(g)), "schools": int(len(sch))}
    return pd.concat(parts, ignore_index=True), diag


def major_estimates(progs: pd.DataFrame, min_programs: int = 20) -> pd.DataFrame:
    """
    Per-major program estimate: shrink y_raw toward 0 (the national median for that
    major) by b = τ_m² / (τ_m² + se²). τ_m is the between-program SD within the major;
    majors with too few programs use the credential's median τ_m.
    """
    out = progs.copy()
    has = out["y_raw"].notna()
    keys = ["credential", "CIPCODE"]
    g = out[has].groupby(keys)
    tau2 = (g["y_raw"].var() - g["se2"].mean()).clip(lower=MIN_PROGRAM_VARIANCE)
    enough = g.size() >= min_programs
    fallback = tau2[enough].groupby(level="credential").median()
    tau2 = tau2.where(enough, tau2.index.get_level_values("credential").map(fallback).to_numpy())
    t2 = pd.Series(tau2, name="tau2_major").reset_index()
    out = out.merge(t2, on=keys, how="left")
    b = out["tau2_major"] / (out["tau2_major"] + out["se2"])
    out["y_major"] = b * out["y_raw"]
    out["y_major_sd"] = np.sqrt(b * out["se2"])
    return out


def expected_earnings(progs: pd.DataFrame, horizon: str = "5yr") -> pd.Series:
    """Completion-weighted national median for each school's bachelor's major mix."""
    b = progs[(progs["credential"] == "bachelors") & (progs["completions"] > 0)]
    nat = b[f"nat_{horizon}"].fillna(b["nat_4yr"])
    ok = nat.notna()
    b = b.assign(wx=b["completions"] * nat)[ok]
    g = b.groupby("UNITID")
    return (g["wx"].sum() / g["completions"].sum()).rename("expected_earnings")
