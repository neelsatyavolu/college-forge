#!/usr/bin/env python3
"""Out-of-sample backtest of program earnings estimators (methodology §10).

Question: using only earlier graduating classes, which estimator best predicts the next
classes' earnings premium for the same program?

  past   = AY2014-16 graduates: 4-year earnings (FoS 1819_1920), else 5-year (FoS 1920_2021)
  target = AY2017-19 graduates: 4-year earnings (current release)

Completion years do not overlap. Programs are matched on OPEID6 × CIP4 × credential.
The past side uses exactly the production observation model (programs.program_premiums)
and the headline's flat prior.

Protocol (fixed before evaluation):
  1. Institutions are split 80/20 by a hash of their OPEID6 group (development / test).
  2. On development institutions only: calibrate the effective error scale σ, then choose
     estimator × shrinkage multiplier k from a fixed grid by within-major RMSE.
  3. Score the frozen choice once on test institutions.

"Within-major" metrics remove each major's mean error: historical baselines are medians of
program medians while the current one is Scorecard's national median, so every estimator
shares a per-major offset that says nothing about ordering schools within a major.
"""
from __future__ import annotations

import json
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import nnls

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import OUT, RAW  # noqa: E402
from institutions import load_institutions, major_universe  # noqa: E402
from programs import (  # noqa: E402
    CREDENTIALS,
    _weighted_median,
    collapse_branch_campuses,
    load_programs,
    major_estimates,
    price_prior,
    program_estimates,
    program_premiums,
    school_effects,
)
from util import to_num  # noqa: E402

HIST = RAW / "all"
PAST_4YR = HIST / "FieldOfStudyData1819_1920_PP.csv"  # EARN_MDN_4YR = AY2014-16 graduates
PAST_5YR = HIST / "FieldOfStudyData1920_2021_PP.csv"  # EARN_MDN_5YR = AY2014-16 graduates
KEYS = ["group", "CIPCODE", "CREDLEV"]
MEDIAN_SE = 1.2533
MIN_TARGET_N = 50
TEST_SHARE = 0.20
K_GRID = (0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0)
ESTIMATORS = ("major_shrink", "hierarchical")
MIN_MAJOR_PROGRAMS = 5  # for within-major metrics


def is_test(groups: pd.Series) -> pd.Series:
    """Stable institution split: True = test. CRC32 of the OPEID6 group key."""
    return groups.map(lambda g: zlib.crc32(str(g).encode()) / 2 ** 32 < TEST_SHARE).astype(bool)


def _read(path: Path, cols: list[str]) -> pd.DataFrame:
    df = pd.read_csv(path, usecols=lambda c: c in cols, low_memory=False)
    df = df[df["CREDLEV"].isin(CREDENTIALS)].copy()
    for c in cols:
        if c in df.columns and c not in {"CIPCODE", "OPEID6"}:
            df[c] = to_num(df[c])
    df["CIPCODE"] = df["CIPCODE"].astype(str).str.replace(r"\.0$", "", regex=True).str.zfill(4)
    df["completions"] = df[["IPEDSCOUNT1", "IPEDSCOUNT2"]].mean(axis=1)
    # Older files split some programs by DISTANCE; keep the row that carries earnings.
    count = df.filter(like="EARN_COUNT_WNE").max(axis=1).fillna(-1)
    df = df.assign(_n=count).sort_values("_n", ascending=False).drop_duplicates(
        ["UNITID", "CIPCODE", "CREDLEV"]).drop(columns="_n")
    return collapse_branch_campuses(df)


def load_past() -> pd.DataFrame:
    base = ["UNITID", "OPEID6", "MAIN", "CIPCODE", "CREDLEV", "IPEDSCOUNT1", "IPEDSCOUNT2"]
    four = _read(PAST_4YR, base + ["EARN_MDN_4YR", "EARN_COUNT_WNE_4YR"])
    five = _read(PAST_5YR, base + ["EARN_MDN_5YR", "EARN_COUNT_WNE_5YR"])
    df = four.merge(five[KEYS + ["UNITID", "EARN_MDN_5YR", "EARN_COUNT_WNE_5YR"]],
                    on=KEYS, how="outer", suffixes=("", "_5yr"))
    df["UNITID"] = df["UNITID"].fillna(df.pop("UNITID_5yr"))
    df["credential"] = df["CREDLEV"].map(CREDENTIALS)
    # This release leaves the national medians empty: earner-weighted medians of program
    # medians (all institutions), the construction the pipeline uses for the 5-year horizon.
    for h in ("4", "5"):
        nat = df.groupby(["CIPCODE", "CREDLEV"]).apply(
            lambda g, h=h: _weighted_median(g[f"EARN_MDN_{h}YR"], g[f"EARN_COUNT_WNE_{h}YR"]), include_groups=False
        ).rename(f"nat_{h}yr")
        df = df.merge(nat, left_on=["CIPCODE", "CREDLEV"], right_index=True, how="left")
    return df.assign(EARN_MDN_1YR=np.nan, EARN_COUNT_WNE_1YR=np.nan, nat_1yr=np.nan)


def load_target() -> pd.DataFrame:
    cur = load_programs()
    y = np.log(cur["EARN_MDN_4YR"] / cur["EARN_MDN_4YR_NAT"])
    t = cur.assign(y_target=y, n_target=cur["EARN_COUNT_WNE_4YR"])
    return t[KEYS + ["y_target", "n_target"]].dropna()


def estimates(past: pd.DataFrame, log_sd) -> pd.DataFrame:
    """Every candidate's prediction per past program (headline model: flat prior)."""
    progs = program_premiums(past, log_sd=log_sd)
    flat = pd.Series(0.0, index=pd.Index(progs["UNITID"].dropna().unique()))
    prior = price_prior(progs, flat)
    progs = major_estimates(progs, flat, prior)
    schools, diag = school_effects(progs, flat, prior)
    # Estimation uncertainty only; the calibrated floor is added once, in coverage().
    progs = program_estimates(progs, schools, diag, floor_sd={c: 0.0 for c in CREDENTIALS.values()})
    return progs.assign(
        pred_national=0.0,
        pred_raw=progs["y_raw"],
        pred_major_shrink=progs["y_major"],
        pred_school_only=progs["mu_hat"],
        pred_hierarchical=progs["y_program"],
        sd_major_shrink=progs["y_major_sd"],
        sd_hierarchical=progs["y_program_sd"],
    )


def _within_major(d: pd.DataFrame, col: str) -> pd.Series:
    """Error minus its major × credential mean (majors with too few programs dropped)."""
    err = d[col] - d["y_target"]
    grp = [d["credential"], d["CIPCODE"]]
    size = err.groupby(grp).transform("size")
    return (err - err.groupby(grp).transform("mean")).where(size >= MIN_MAJOR_PROGRAMS)


def calibrate_noise(past: pd.DataFrame, target: pd.DataFrame) -> dict:
    """
    Effective error scale on the given (development) rows. For Δ = y_target − y_past,
    after removing each major's mean shift:  E[Δ²] ≈ d² + σ²·1.2533²·(1/n_t + 1/n_p),
    fitted with non-negative least squares. σ is an effective count-dependent error scale,
    not a measured within-program income SD; d² is the count-independent remainder.
    """
    p = program_premiums(past, log_sd=1.0)
    d = p.merge(target, on=KEYS).dropna(subset=["y_raw", "earners", "y_target", "n_target"])
    d = d.assign(delta=d["y_target"] - d["y_raw"])
    grp = [d["credential"], d["CIPCODE"]]
    d = d.assign(delta=d["delta"] - d.groupby(grp)["delta"].transform("mean"),
                 size=d.groupby(grp)["delta"].transform("size"))
    d = d[d["size"] >= MIN_MAJOR_PROGRAMS]
    out = {}
    for cred, g in d.groupby("credential"):
        x = MEDIAN_SE ** 2 * (1 / g["n_target"] + 1 / g["earners"])
        A = np.column_stack([np.ones(len(g)), x])
        (floor2, sigma2), _ = nnls(A, (g["delta"] ** 2).to_numpy())
        out[cred] = {"n_pairs": int(len(g)), "sigma": float(np.sqrt(sigma2)), "floor_sd": float(np.sqrt(floor2))}
    return out


def evaluate(pred: pd.DataFrame, target: pd.DataFrame, col: str, test: bool) -> dict:
    d = pred.merge(target, on=KEYS)
    d = d[d["y_raw"].notna() & (d["n_target"] >= MIN_TARGET_N)]
    d = d[is_test(d["group"]) == test]
    out = {}
    for cred, g in d.groupby("credential"):
        wm = _within_major(g, col).dropna()
        rho = [grp[col].corr(grp["y_target"], method="spearman")
               for _, grp in g.groupby("CIPCODE") if len(grp) >= 20 and grp[col].nunique() > 1]
        out[cred] = {"within_major_rmse": float(np.sqrt((wm ** 2).mean())),
                     "rmse": float(np.sqrt(((g[col] - g["y_target"]) ** 2).mean())),
                     "rho": float(np.nanmean(rho)) if rho else None, "n": int(len(g))}
    return out


def coverage(pred: pd.DataFrame, target: pd.DataFrame, est: str, noise: dict, cred: str) -> dict:
    """
    Test-institution coverage of 90% intervals for the chosen estimator (≥MIN_TARGET_N
    earners), overall and by target-size tercile. Errors are NOT re-centered on test
    outcomes: the per-major offset between the two files' national medians is estimated on
    development institutions and frozen before testing. SD = estimation SD + the target's
    sampling noise, with and without the development-fitted floor (added once).
    """
    d = pred.merge(target, on=KEYS)
    d = d[(d["credential"] == cred) & d[f"pred_{est}"].notna() & (d["n_target"] >= MIN_TARGET_N)]
    err = d[f"pred_{est}"] - d["y_target"]
    dev = ~is_test(d["group"])
    offset = err[dev].groupby(d.loc[dev, "CIPCODE"]).mean()
    d = d.assign(err=err - d["CIPCODE"].map(offset).fillna(err[dev].mean()))
    d = d[is_test(d["group"])]
    noise_t = (MEDIAN_SE * noise[cred]["sigma"]) ** 2 / d["n_target"]
    size = pd.qcut(d["n_target"], 3, labels=["small", "medium", "large"])
    res = {}
    floor2 = noise[cred]["floor_sd"] ** 2
    variants = (
        # Next-class prediction intervals (the target also carries its own sampling noise).
        ("estimate_plus_target_noise", noise_t, 0.0),
        ("with_floor", noise_t, floor2),
        # The width actually published behind rank ranges: estimate + floor, no target noise.
        ("published_width", 0.0, floor2),
    )
    for label, target_noise, floor in variants:
        sd = np.sqrt(d[f"sd_{est}"] ** 2 + target_noise + floor)
        inside = d["err"].abs() <= 1.645 * sd
        by_size = inside.groupby(size, observed=True).mean()
        res[label] = {"all": float(inside.mean()), **{str(k): float(v) for k, v in by_size.items()}}
    return res


def main() -> int:
    universe = set(major_universe(load_institutions())["UNITID"])
    past = load_past()
    past = past[past["UNITID"].isin(universe)]
    target = load_target()

    dev_past, dev_target = past[~is_test(past["group"])], target[~is_test(target["group"])]
    noise = calibrate_noise(dev_past, dev_target)  # development institutions only
    sigma = past["credential"].map({c: v["sigma"] for c, v in noise.items()})

    grid = {}
    for k in K_GRID:
        pred = estimates(past, sigma * np.sqrt(k))
        for est in ESTIMATORS:
            grid[(est, k)] = {"dev": evaluate(pred, target, f"pred_{est}", False), "pred": pred}

    baseline_raw = estimates(past, sigma)
    baseline_sd070 = estimates(past, 0.70)
    chosen = {}
    for cred in CREDENTIALS.values():
        est, k = min(grid, key=lambda key: grid[key]["dev"][cred]["within_major_rmse"])
        pred = grid[(est, k)]["pred"]
        chosen[cred] = {
            "estimator": est, "k": k,
            "dev": grid[(est, k)]["dev"][cred],
            "test": evaluate(pred, target, f"pred_{est}", True)[cred],
            "test_raw_baseline": evaluate(baseline_raw, target, "pred_raw", True)[cred],
            "test_major_only_sd070": evaluate(baseline_sd070, target, "pred_major_shrink", True)[cred],
            "coverage_90": coverage(pred, target, est, noise, cred),
        }
    results = {
        "design": {
            "past": "AY2014-16 graduates: 4-year earnings, else 5-year (production observation model)",
            "target": "AY2017-19 graduates: 4-year earnings (current release)",
            "match": "OPEID6 × CIP4 × credential; no overlapping completion years",
            "split": f"{int(TEST_SHARE * 100)}% of institutions (CRC32 of OPEID6) held out of calibration and selection",
            "criterion": "within-major RMSE on development institutions",
            "min_target_earners": MIN_TARGET_N,
        },
        "noise_calibration": noise,
        "chosen": chosen,
        "dev_grid": {f"{e}|k={k}": {c: v["dev"][c]["within_major_rmse"] for c in CREDENTIALS.values()}
                     for (e, k), v in grid.items()},
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "backtest.json").write_text(json.dumps(results, indent=2))
    print(json.dumps({"noise": noise, "chosen": chosen}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
