"""Shared helpers."""
from __future__ import annotations

import re
from typing import Iterable

import numpy as np
import pandas as pd


PS = {"PrivacySuppressed", "PS", "NULL", "None", "nan", ""}


def to_num(s: pd.Series) -> pd.Series:
    if s.dtype.kind in "iufc":
        return pd.to_numeric(s, errors="coerce")
    out = s.astype(str).str.strip()
    out = out.replace({p: np.nan for p in PS})
    return pd.to_numeric(out, errors="coerce")


def pctile_rank(x: pd.Series) -> pd.Series:
    """Percentile rank in [0, 100] over non-null values; nulls stay null."""
    r = x.rank(method="average", pct=True, na_option="keep") * 100.0
    return r


def haversine_mi(lat1, lon1, lat2, lon2) -> np.ndarray:
    """Great-circle distance in miles. Inputs may be scalars or arrays."""
    r = 3958.7613
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))


def opeid8(v) -> str | None:
    """Normalize Scorecard OPEID to 8-digit PSEO-style string."""
    if v is None:
        return None
    try:
        if isinstance(v, float) and np.isnan(v):
            return None
        # Avoid str(105100.0) → "105100.0" → digits "1051000"
        n = int(float(v))
    except (TypeError, ValueError):
        s = re.sub(r"\D", "", str(v))
        if not s:
            return None
        n = int(s)
    return str(n).zfill(8)[-8:]


def opeid6(v) -> str | None:
    s = opeid8(v)
    return s[:6] if s else None


def spearman(a: pd.Series, b: pd.Series) -> float:
    d = pd.concat([a, b], axis=1).dropna()
    if len(d) < 5:
        return float("nan")
    return float(d.iloc[:, 0].corr(d.iloc[:, 1], method="spearman"))


def pearson(a: pd.Series, b: pd.Series) -> float:
    d = pd.concat([a, b], axis=1).dropna()
    if len(d) < 5:
        return float("nan")
    return float(d.iloc[:, 0].corr(d.iloc[:, 1], method="pearson"))


def top_n_churn(rank_a: pd.Series, rank_b: pd.Series, n: int = 25) -> int:
    """How many of top-n by A are missing from top-n by B."""
    a = set(rank_a.nsmallest(n).index)
    b = set(rank_b.nsmallest(n).index)
    return len(a - b)


def crossfit_residuals(y: pd.Series, X: pd.DataFrame, folds: int = 10, seed: int = 42) -> pd.Series:
    """Out-of-fold OLS residuals: each row is predicted by a model fit without its fold."""
    df = pd.concat([y.rename("y"), X], axis=1).dropna()
    out = pd.Series(np.nan, index=y.index, dtype=float)
    if len(df) < folds * (X.shape[1] + 3):
        return out
    fold = np.random.default_rng(seed).permutation(len(df)) % folds
    xx = np.column_stack([np.ones(len(df)), df.drop(columns=["y"]).to_numpy(dtype=float)])
    yy = df["y"].to_numpy(dtype=float)
    pred = np.empty(len(df))
    for k in range(folds):
        test = fold == k
        beta, *_ = np.linalg.lstsq(xx[~test], yy[~test], rcond=None)
        pred[test] = xx[test] @ beta
    out.loc[df.index] = yy - pred
    return out


def write_csv(df: pd.DataFrame, path, **kw):
    path = path if hasattr(path, "write_text") else path
    from pathlib import Path

    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(p, index=False, **kw)
    print(f"  wrote {p} ({len(df):,} rows)")
