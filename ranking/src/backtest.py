#!/usr/bin/env python3
"""Retrospective backtest of program earnings estimators (methodology §10).

Question: using only earlier graduating classes, which estimator best predicts the next
classes' earnings premium for the same program?

  past   = AY2014-16 graduates: 4-year earnings (FoS 1819_1920), else 5-year (FoS 1920_2021)
  target = AY2017-19 graduates: 4-year earnings (current release)

Completion years do not overlap. Programs are matched on OPEID6 × CIP4 × credential.
The past side uses the production observation model (programs.program_premiums) and the
as-reported view's flat prior.

Protocol:
  1. Institutions are split 80/20 by a hash of their OPEID6 group (development / test).
  2. On development institutions only: fit the 5-year → 4-year mapping, calibrate the
     effective error scale σ, then choose estimator × shrinkage multiplier k from a fixed
     grid by major-centered RMSE.
  3. Score the frozen choice on test institutions.
Earlier versions of this test were run and revised with the test results in view, so this
is an exploratory retrospective evaluation, not an untouched confirmatory holdout.

Error measures (log points ≈ percent):
  - major-centered RMSE ("within_major_rmse"): each method's own mean error per major on
    the evaluated rows is removed. It isolates ordering within a major, but it also
    absorbs any major-wide bias of that method, so it is reported next to:
  - dev-offset RMSE: per-major offsets estimated on development institutions and frozen;
  - uncentered RMSE.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import zlib
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import nnls

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import FOS_CSV, INST_CSV, OUT, RAW, ROOT  # noqa: E402
from institutions import load_institutions, major_universe  # noqa: E402
from programs import (  # noqa: E402
    CREDENTIALS,
    SHIFT_LEVELS,
    _weighted_median,
    collapse_branch_campuses,
    fit_horizon_shift,
    horizon_pairs,
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
MIN_MAJOR_PROGRAMS = 5  # for major-centered metrics
MIN_RHO_PROGRAMS = 20  # majors entering the average rank correlation
SMALL_FIVE_YEAR_N = 30  # "small program" stratum of the horizon test
REPEAT_SALTS = ("r1", "r2", "r3", "r4", "r5")
N_BOOT_CI = 1000


def _unit_hash(key: str, salt: str) -> float:
    """Uniform [0, 1) per key: CRC32 for the primary split (unchanged since v3.0), SHA-256 for salted repeats."""
    if not salt:
        return zlib.crc32(key.encode()) / 2 ** 32
    return int.from_bytes(hashlib.sha256(f"{salt}:{key}".encode()).digest()[:8], "big") / 2 ** 64


def is_test(groups: pd.Series, salt: str = "") -> pd.Series:
    """Stable institution split: True = test, by a hash of the OPEID6 group key (+ optional salt)."""
    return groups.map(lambda g: _unit_hash(str(g), salt) < TEST_SHARE).astype(bool)


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


def load_target(cur: pd.DataFrame) -> pd.DataFrame:
    y = np.log(cur["EARN_MDN_4YR"] / cur["EARN_MDN_4YR_NAT"])
    t = cur.assign(y_target=y, n_target=cur["EARN_COUNT_WNE_4YR"])
    return t[KEYS + ["y_target", "n_target"]].dropna()


# ---------------------------------------------------------------- 5-year → 4-year mapping

def _cross_fit_substitution(pairs: pd.DataFrame, level: str, salt: str, folds: int = 5) -> pd.Series:
    """Out-of-fold prediction of y4 from y5 within the given rows (institution folds)."""
    fold = pairs["group"].map(lambda g: zlib.crc32(f"fold{salt}{g}".encode()) % folds)
    pred = pd.Series(np.nan, index=pairs.index)
    for f in range(folds):
        held = fold == f
        shift = fit_horizon_shift(pairs[~held], level)
        delta, _ = shift.lookup(pairs.loc[held, "credential"], pairs.loc[held, "CIPCODE"])
        pred.loc[held] = (pairs.loc[held, "y5"] - delta).to_numpy(dtype=float)
    return pred


def horizon_test(cur: pd.DataFrame, noise: dict, salt: str = "") -> dict:
    """
    Held-out check of the 5-year → 4-year mapping on the current release's programs that
    publish both horizons (a 5-year class three years older than the 4-year class).

    Rule, fixed before scoring test institutions: the mapping level ("none", "credential",
    "major") with the lowest cross-fitted uncentered RMSE on development institutions is
    selected; it ships only if, on test institutions, it does not raise uncentered RMSE
    versus no correction, overall or for small programs (fewer than SMALL_FIVE_YEAR_N
    5-year earners). Otherwise no correction ships.
    Matched programs are larger than 5-year-only programs, so this checks substitution
    where both are observed, not the suppressed cases themselves.
    """
    pairs = horizon_pairs(cur)
    test = is_test(pairs["group"], salt)
    dev_pairs = pairs[~test]
    dev_rmse = {}
    for level in SHIFT_LEVELS:
        pred = _cross_fit_substitution(dev_pairs, level, salt)
        dev_rmse[level] = {c: float(np.sqrt(((pred[g.index] - g["y4"]) ** 2).mean()))
                           for c, g in dev_pairs.groupby("credential")}
    chosen = min(SHIFT_LEVELS, key=lambda lv: np.mean(list(dev_rmse[lv].values())))

    test_pairs = pairs[test]
    out: dict = {"dev_cross_fit_rmse": dev_rmse, "selected_on_dev": chosen, "test": {}}
    errs = {}
    for level in SHIFT_LEVELS:
        shift = fit_horizon_shift(dev_pairs, level)
        delta, var = shift.lookup(test_pairs["credential"], test_pairs["CIPCODE"])
        errs[level] = (test_pairs["y5"] - delta - test_pairs["y4"], var)
    for cred, g in test_pairs.groupby("credential"):
        sigma, floor = noise[cred]["sigma"], noise[cred]["floor_sd"]
        samp = (MEDIAN_SE * sigma) ** 2 * (1 / g["n4"].clip(lower=10) + 1 / g["n5"].clip(lower=10))
        small = g["n5"] < SMALL_FIVE_YEAR_N
        res = {"n_programs": int(len(g)), "n_institutions": int(g["group"].nunique()),
               "n_small": int(small.sum())}
        for level, (e, var) in errs.items():
            e = e[g.index]
            inside = e.abs() <= 1.645 * np.sqrt(samp + floor ** 2 + var[g.index])
            res[level] = {
                "rmse": float(np.sqrt((e ** 2).mean())), "bias": float(e.mean()),
                "rmse_small": float(np.sqrt((e[small] ** 2).mean())),
                "coverage_90": float(inside.mean()), "coverage_90_small": float(inside[small].mean()),
            }
        res["major_minus_none_rmse_90ci"] = _paired_ci(errs["major"][0][g.index], errs["none"][0][g.index], g["group"], None)
        res["major_minus_credential_rmse_90ci"] = _paired_ci(errs["major"][0][g.index], errs["credential"][0][g.index], g["group"], None)
        out["test"][cred] = res
    ok = all(r[chosen]["rmse"] <= r["none"]["rmse"] and r[chosen]["rmse_small"] <= r["none"]["rmse_small"]
             for r in out["test"].values())
    # Release gate for PRODUCTION only (config.HORIZON_SHIFT_LEVEL). The backtest itself uses
    # selected_on_dev, so test outcomes never feed its calibration or selection.
    out["shipped"] = chosen if ok else "none"
    return out


# ---------------------------------------------------------------- estimators and metrics

def estimates(past: pd.DataFrame, log_sd, shift) -> pd.DataFrame:
    """Every candidate's prediction per past program (as-reported model: flat prior)."""
    progs = program_premiums(past, log_sd=log_sd, shift=shift)
    flat = pd.Series(0.0, index=pd.Index(progs["UNITID"].dropna().unique()))
    prior = price_prior(progs, flat)
    progs = major_estimates(progs, flat, prior)
    schools, diag = school_effects(progs, flat, prior)
    # Estimation uncertainty only; the calibrated floor is added once, in coverage().
    progs = program_estimates(progs, schools, diag, floor_sd={c: 0.0 for c in CREDENTIALS.values()})
    return progs.assign(
        pred_raw=progs["y_raw"],
        pred_major_shrink=progs["y_major"],
        pred_hierarchical=progs["y_program"],
        sd_major_shrink=progs["y_major_sd"],
        sd_hierarchical=progs["y_program_sd"],
    )


def _centered(err: pd.Series, d: pd.DataFrame) -> pd.Series:
    """Error minus its major × credential mean (majors with too few programs dropped)."""
    grp = [d["credential"], d["CIPCODE"]]
    size = err.groupby(grp).transform("size")
    return (err - err.groupby(grp).transform("mean")).where(size >= MIN_MAJOR_PROGRAMS)


def _paired_ci(e_a: pd.Series, e_b: pd.Series, groups: pd.Series, majors: pd.Series | None, seed: int = 7) -> list[float]:
    """
    90% institution-clustered bootstrap CI for RMSE(a) − RMSE(b) on the same rows. With
    `majors`, errors are major-centered and the centering is recomputed in every draw
    (majors with < MIN_MAJOR_PROGRAMS weighted rows dropped); without, errors are uncentered.
    """
    ok = e_a.notna() & e_b.notna()
    a, b, grp = e_a[ok].to_numpy(), e_b[ok].to_numpy(), groups[ok].to_numpy()
    codes, cl = np.unique(grp, return_inverse=True)
    mj = np.unique(majors[ok].to_numpy(), return_inverse=True)[1] if majors is not None else np.zeros(len(a), dtype=int)
    rng = np.random.default_rng(seed)

    def rmse(e: np.ndarray, w: np.ndarray) -> float:
        if majors is not None:
            wn = np.bincount(mj, w)
            mean = np.bincount(mj, w * e) / np.where(wn > 0, wn, 1)
            keep = (wn >= MIN_MAJOR_PROGRAMS)[mj]
            e, w = (e - mean[mj])[keep], w[keep]
        return float(np.sqrt((w * e ** 2).sum() / w.sum()))

    diff = np.empty(N_BOOT_CI)
    for i in range(N_BOOT_CI):
        w = np.bincount(rng.integers(0, len(codes), len(codes)), minlength=len(codes))[cl].astype(float)
        diff[i] = rmse(a, w) - rmse(b, w)
    return [float(np.percentile(diff, 5)), float(np.percentile(diff, 95))]


def _paired_test_errors(preds: list[tuple[pd.DataFrame, str]], target: pd.DataFrame, cred: str) -> list[pd.Series]:
    """Uncentered test errors of several estimators on the SAME headline rows, plus groups and majors."""
    d = target
    for i, (p, col) in enumerate(preds):
        d = d.merge(p.loc[p["y_raw"].notna(), KEYS + ["credential", col]].rename(columns={col: f"p{i}"}),
                    on=KEYS, suffixes=("", f"_{i}"))
    d = d[(d["credential"] == cred) & (d["n_target"] >= MIN_TARGET_N) & is_test(d["group"])]
    d = d.dropna(subset=[f"p{i}" for i in range(len(preds))]).reset_index(drop=True)
    return [d[f"p{i}"] - d["y_target"] for i in range(len(preds))] + [d["group"], d["CIPCODE"]]


def _dev_offsets(d: pd.DataFrame, col: str, test: pd.Series) -> pd.Series:
    """Per credential × major mean error on development rows (target ≥ MIN_TARGET_N), frozen."""
    dev = d[~test & (d["n_target"] >= MIN_TARGET_N)]
    err = dev[col] - dev["y_target"]
    per_major = err.groupby([dev["credential"], dev["CIPCODE"]]).mean()
    per_cred = err.groupby(dev["credential"]).mean()
    keys = pd.MultiIndex.from_arrays([d["credential"], d["CIPCODE"]])
    off = pd.Series(per_major.reindex(keys).to_numpy(), index=d.index)
    return off.fillna(d["credential"].map(per_cred))


def _metrics(g: pd.DataFrame, col: str) -> dict:
    err = g[col] - g["y_target"]
    wm = _centered(err, g).dropna()
    rho_groups = [grp for _, grp in g.groupby("CIPCODE") if len(grp) >= MIN_RHO_PROGRAMS and grp[col].nunique() > 1]
    rho = [grp[col].corr(grp["y_target"], method="spearman") for grp in rho_groups]
    return {
        "within_major_rmse": float(np.sqrt((wm ** 2).mean())) if len(wm) else None,
        "dev_offset_rmse": float(np.sqrt(((err - g["offset"]) ** 2).mean())),
        "rmse": float(np.sqrt((err ** 2).mean())),
        "rho": float(np.nanmean(rho)) if rho else None,
        "n": int(len(g)),
        "n_institutions": int(g["group"].nunique()),
        "n_centered_programs": int(len(wm)),
        "n_centered_majors": int(g.loc[wm.index, "CIPCODE"].nunique()),
        "n_rho_programs": int(sum(len(grp) for grp in rho_groups)),
        "n_rho_majors": len(rho),
    }


def _frame(pred: pd.DataFrame, target: pd.DataFrame, col: str, salt: str) -> pd.DataFrame:
    d = pred.merge(target, on=KEYS)
    d = d[d["y_raw"].notna() & d[col].notna()]
    test = is_test(d["group"], salt)
    return d.assign(offset=_dev_offsets(d, col, test), is_test=test)


def evaluate(pred: pd.DataFrame, target: pd.DataFrame, col: str, test: bool, salt: str = "") -> dict:
    """Headline stratum: programs whose later class has ≥ MIN_TARGET_N earners."""
    d = _frame(pred, target, col, salt)
    d = d[(d["is_test"] == test) & (d["n_target"] >= MIN_TARGET_N)]
    return {cred: _metrics(g, col) for cred, g in d.groupby("credential")}


def strata(pred: pd.DataFrame, target: pd.DataFrame, col: str) -> dict:
    """Test-institution results outside the headline stratum."""
    d = _frame(pred, target, col, "")
    d = d[d["is_test"]]
    parts = {
        "target_under_50_earners": d[d["n_target"] < MIN_TARGET_N],
        "past_used_5yr_fallback": d[(d["earnings_horizon"] == "5yr") & (d["n_target"] >= MIN_TARGET_N)],
    }
    return {name: {cred: _metrics(g, col) for cred, g in part.groupby("credential")} for name, part in parts.items()}


def calibrate_noise(past: pd.DataFrame, target: pd.DataFrame, shift=None) -> dict:
    """
    Effective error scale on the given (development) rows. For Δ = y_target − y_past,
    after removing each major's mean shift:  E[Δ²] ≈ d² + σ²·1.2533²·(1/n_t + 1/n_p),
    fitted with non-negative least squares. σ is an effective count-dependent error scale,
    not a measured within-program income SD; d² is the count-independent remainder.
    """
    p = program_premiums(past, log_sd=1.0, shift=shift)
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


def coverage(pred: pd.DataFrame, target: pd.DataFrame, est: str, noise: dict, cred: str, small: bool = False) -> dict:
    """
    Test-institution coverage of 90% intervals for the chosen estimator (≥MIN_TARGET_N
    earners), overall and by target-size tercile. Errors are NOT re-centered on test
    outcomes: per-major offsets come from development institutions, frozen before testing.
    SD = estimation SD + the target's sampling noise (which uses the later class's earner
    count, so these are conditional retrospective intervals), with and without the
    development-fitted floor (added once).
    """
    col = f"pred_{est}"
    d = _frame(pred, target, col, "")
    size_ok = d["n_target"] < MIN_TARGET_N if small else d["n_target"] >= MIN_TARGET_N
    d = d[(d["credential"] == cred) & d["is_test"] & size_ok]
    err = d[col] - d["y_target"] - d["offset"]
    noise_t = (MEDIAN_SE * noise[cred]["sigma"]) ** 2 / d["n_target"]
    size = pd.qcut(d["n_target"], 3, labels=["small", "medium", "large"])
    res = {"n": int(len(d))}
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
        inside = err.abs() <= 1.645 * sd
        by_size = inside.groupby(size, observed=True).mean()
        res[label] = {"all": float(inside.mean()), **{str(k): float(v) for k, v in by_size.items()}}
    return res


def select(past: pd.DataFrame, target: pd.DataFrame, level: str, salt: str = "") -> dict:
    """
    Everything fitted on development institutions only: the historical 5-year mapping,
    the noise calibration, and the estimator × k grid. Test targets never enter.
    """
    dev_past = past[~is_test(past["group"], salt)]
    dev_target = target[~is_test(target["group"], salt)]
    shift = fit_horizon_shift(dev_past, level)
    noise = calibrate_noise(dev_past, dev_target, shift)
    sigma = past["credential"].map({c: v["sigma"] for c, v in noise.items()})
    preds, grid = {}, {}
    for k in K_GRID:
        preds[k] = estimates(past, sigma * np.sqrt(k), shift)
        for est in ESTIMATORS:
            grid[(est, k)] = evaluate(preds[k], target, f"pred_{est}", False, salt)
    chosen, tuned_major_only = {}, {}
    for cred in noise:
        chosen[cred] = min(grid, key=lambda key: grid[key][cred]["within_major_rmse"])
        tuned_major_only[cred] = min((key for key in grid if key[0] == "major_shrink"),
                                     key=lambda key: grid[key][cred]["within_major_rmse"])
    return {"shift": shift, "noise": noise, "sigma": sigma, "preds": preds, "grid": grid,
            "chosen": chosen, "tuned_major_only": tuned_major_only}


def protocol(past: pd.DataFrame, cur: pd.DataFrame, salt: str = "") -> tuple[pd.DataFrame, dict, dict]:
    """
    The full backtest protocol on one split. The 5-year mapping level used for the
    historical evaluation is the development-selected one (selected_on_dev); the
    test-scored release gate (horizon["shipped"]) is reported but never used here.
    """
    target = load_target(cur)
    dev = ~is_test(past["group"], salt)
    # Interval widths for the horizon check come from an uncorrected dev calibration.
    noise0 = calibrate_noise(past[dev], target[~is_test(target["group"], salt)], fit_horizon_shift(past[dev], "none"))
    horizon = horizon_test(cur, noise0, salt)
    return target, horizon, select(past, target, horizon["selected_on_dev"], salt)


def repeated_splits(past: pd.DataFrame, cur: pd.DataFrame) -> dict:
    """Stability: rerun the whole protocol (mapping level included) on other institution splits."""
    out = {}
    for salt in REPEAT_SALTS:
        target, horizon, s = protocol(past, cur, salt)
        raw = estimates(past, s["sigma"], s["shift"])
        row = {}
        for cred, (est, k) in s["chosen"].items():
            t = evaluate(s["preds"][k], target, f"pred_{est}", True, salt)[cred]
            r = evaluate(raw, target, "pred_raw", True, salt)[cred]
            row[cred] = {"estimator": est, "k": k, "horizon_level": horizon["selected_on_dev"],
                         "test_within_major_rmse": t["within_major_rmse"],
                         "raw_within_major_rmse": r["within_major_rmse"], "test_rho": t["rho"], "raw_rho": r["rho"]}
        out[salt] = row
    return out


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def provenance() -> dict:
    def git(*args: str) -> str:
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    return {
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "code_commit": git("rev-parse", "HEAD"),
        "uncommitted_changes_in_ranking": bool(git("status", "--porcelain", "--", "src", "tests")),
        "source_sha256": {p.name: _sha256(p) for p in sorted(Path(__file__).parent.glob("*.py"))},
        "inputs_sha256": {p.name: _sha256(p) for p in (PAST_4YR, PAST_5YR, FOS_CSV, INST_CSV)},
    }


def main() -> int:
    universe = set(major_universe(load_institutions())["UNITID"])
    past = load_past()
    past = past[past["UNITID"].isin(universe)]
    cur = load_programs()
    cur = cur[cur["UNITID"].isin(universe)]
    target, horizon, s = protocol(past, cur)
    baseline_raw = estimates(past, s["sigma"], s["shift"])
    baseline_sd070 = estimates(past, 0.70, s["shift"])
    chosen = {}
    for cred, (est, k) in s["chosen"].items():
        pred = s["preds"][k]
        mo_est, mo_k = s["tuned_major_only"][cred]
        tuned = s["preds"][mo_k]
        e_sel, e_raw, e_mo, groups, majors = _paired_test_errors(
            [(pred, f"pred_{est}"), (baseline_raw, "pred_raw"), (tuned, f"pred_{mo_est}")], target, cred)
        chosen[cred] = {
            "estimator": est, "k": k,
            "dev": s["grid"][(est, k)][cred],
            "test": evaluate(pred, target, f"pred_{est}", True)[cred],
            "test_raw_baseline": evaluate(baseline_raw, target, "pred_raw", True)[cred],
            "test_major_only_sd070": evaluate(baseline_sd070, target, "pred_major_shrink", True)[cred],
            "test_major_only_tuned": {"k": mo_k, **evaluate(tuned, target, "pred_major_shrink", True)[cred]},
            "test_minus_raw_within_major_rmse_90ci": _paired_ci(e_sel, e_raw, groups, majors),
            "test_minus_tuned_major_only_within_major_rmse_90ci": _paired_ci(e_sel, e_mo, groups, majors),
            "strata": {name: v.get(cred) for name, v in strata(pred, target, f"pred_{est}").items()},
            "strata_raw_baseline": {name: v.get(cred) for name, v in strata(baseline_raw, target, "pred_raw").items()},
            "coverage_90": coverage(pred, target, est, s["noise"], cred),
            "coverage_90_target_under_50": coverage(pred, target, est, s["noise"], cred, small=True),
            "dev_grid_neighbors": {f"{e}|k={kk}": s["grid"][(e, kk)][cred]["within_major_rmse"]
                                   for (e, kk) in s["grid"] if e == est},
        }
    results = {
        "provenance": provenance(),
        "design": {
            "past": "AY2014-16 graduates: 4-year earnings, else 5-year mapped to the 4-year scale (production observation model)",
            "target": "AY2017-19 graduates: 4-year earnings (current release)",
            "match": "OPEID6 × CIP4 × credential; no overlapping completion years",
            "split": f"{int(TEST_SHARE * 100)}% of institutions (CRC32 of OPEID6) held out of calibration and selection",
            "horizon_level_used": horizon["selected_on_dev"],
            "criterion": "major-centered RMSE on development institutions",
            "min_target_earners": MIN_TARGET_N,
            "min_major_programs_centered": MIN_MAJOR_PROGRAMS,
            "min_major_programs_rho": MIN_RHO_PROGRAMS,
            "rho_weighting": "equal weight per eligible major",
            "status": "exploratory retrospective evaluation (earlier test results informed revisions)",
        },
        "horizon_mapping": horizon,
        "noise_calibration": s["noise"],
        "chosen": chosen,
        "repeated_splits": repeated_splits(past, cur),
        "dev_grid": {f"{e}|k={k}": {c: v[c]["within_major_rmse"] for c in CREDENTIALS.values()}
                     for (e, k), v in s["grid"].items()},
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "backtest.json").write_text(json.dumps(results, indent=2))
    print(json.dumps({"horizon": horizon, "noise": s["noise"],
                      "chosen": {c: {k: v[k] for k in ("estimator", "k", "test", "test_raw_baseline", "test_major_only_tuned",
                                                       "test_minus_raw_within_major_rmse_90ci", "strata", "coverage_90")}
                                 for c, v in chosen.items()},
                      "repeated": results["repeated_splits"]}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
