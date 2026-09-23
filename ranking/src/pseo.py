"""PSEO graduate destination weights and retention model (§4.2–4.3)."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import cross_val_predict, cross_val_score

from config import PSEO_DEST_CACHE, PSEO_FLOWS, PSEO_INST, PROCESSED
from util import opeid6, opeid8, to_num

DIV_COLS = list(range(1, 10))


def load_pseo_institutions() -> pd.DataFrame:
    df = pd.read_csv(PSEO_INST)
    # strip BOM
    df.columns = [c.lstrip("\ufeff") for c in df.columns]
    df["institution"] = df["institution"].astype(str).str.zfill(8)
    df["opeid6"] = df["institution"].str[:6]
    return df


def _norm_cohort(s: pd.Series) -> pd.Series:
    return (
        s.astype(str)
        .str.replace(r"\.0$", "", regex=True)
        .str.strip()
        .str.zfill(4)
    )


def extract_pseo_retention(max_rows: int | None = None) -> pd.DataFrame:
    """
    For each PSEO institution, bachelor's (degree_level=5), all CIP (cip_level=A),
    industry all, national geography row: retention = in-state emp / total emp at y5.
    """
    usecols = [
        "inst_level", "institution", "degree_level", "cip_level", "cipcode",
        "geo_level", "geography", "ind_level", "industry",
        "y5_grads_emp", "y5_grads_emp_instate", "y1_grads_emp", "y1_grads_emp_instate",
    ]
    rows = []
    n = 0
    for chunk in pd.read_csv(
        PSEO_FLOWS,
        chunksize=400_000,
        usecols=usecols,
        low_memory=False,
        dtype={"institution": str, "geography": str},
    ):
        m = chunk[
            (chunk["inst_level"] == "I")
            & (chunk["degree_level"] == 5)
            & (chunk["cip_level"] == "A")
            & (chunk["ind_level"] == "A")
            & (chunk["geo_level"] == "N")
        ]
        if len(m):
            rows.append(m)
        n += len(chunk)
        if max_rows and n >= max_rows:
            break
    if not rows:
        return pd.DataFrame()
    df = pd.concat(rows, ignore_index=True)
    df["institution"] = df["institution"].astype(str).str.zfill(8)
    df["y5_grads_emp"] = to_num(df["y5_grads_emp"])
    df["y5_grads_emp_instate"] = to_num(df["y5_grads_emp_instate"])
    df["y1_grads_emp"] = to_num(df["y1_grads_emp"])
    df["y1_grads_emp_instate"] = to_num(df["y1_grads_emp_instate"])
    # Prefer y5; fall back to y1
    df["retention_share"] = df["y5_grads_emp_instate"] / df["y5_grads_emp"]
    miss = df["retention_share"].isna()
    df.loc[miss, "retention_share"] = (
        df.loc[miss, "y1_grads_emp_instate"] / df.loc[miss, "y1_grads_emp"]
    )
    # One row per institution (cohort 0000 aggregate often duplicated by cohort years)
    df = (
        df.dropna(subset=["retention_share"])
        .sort_values("y5_grads_emp", ascending=False)
        .drop_duplicates("institution", keep="first")
    )
    df["opeid6"] = df["institution"].str[:6]
    df["retention_source"] = "pseo"
    return df[["institution", "opeid6", "retention_share", "retention_source", "y5_grads_emp"]]


def match_pseo_to_scorecard(
    eligible: pd.DataFrame,
    pseo_ret: pd.DataFrame,
) -> pd.DataFrame:
    """Attach PSEO retention to Scorecard UNITIDs via OPEID8 / OPEID6."""
    el = eligible.copy()
    el["opeid8"] = el["OPEID"].map(opeid8)
    el["opeid6"] = el["OPEID"].map(opeid6)
    # also try OPEID6 field
    el.loc[el["opeid6"].isna(), "opeid6"] = el.loc[el["opeid6"].isna(), "OPEID6"].map(
        lambda x: str(int(x)).zfill(6) if pd.notna(x) else None
    )

    p = pseo_ret.copy()
    m8 = el.merge(
        p.rename(columns={"institution": "opeid8"}),
        on="opeid8",
        how="left",
        suffixes=("", "_p"),
    )
    # fill via opeid6 where needed
    need = m8["retention_share"].isna()
    p6 = p.drop_duplicates("opeid6").set_index("opeid6")
    m8.loc[need, "retention_share"] = m8.loc[need, "opeid6"].map(p6["retention_share"])
    m8.loc[need & m8["retention_share"].notna(), "retention_source"] = "pseo"
    return m8


def _sat_features(df: pd.DataFrame) -> pd.DataFrame:
    sat = to_num(df["SAT_AVG"]) if "SAT_AVG" in df.columns else pd.Series(np.nan, index=df.index)
    return pd.DataFrame({
        "SAT_AVG": sat,
        "sat_missing": sat.isna().astype(float),
    }, index=df.index)


def _design_matrix(df: pd.DataFrame, feats: list[str], med: dict[str, float]) -> pd.DataFrame:
    X = pd.DataFrame(index=df.index)
    for c in feats:
        if c == "sat_missing":
            sat = to_num(df["SAT_AVG"]) if "SAT_AVG" in df.columns else pd.Series(np.nan, index=df.index)
            X[c] = sat.isna().astype(float)
        elif c == "log_ugds":
            ug = to_num(df["UGDS"]) if "UGDS" in df.columns else pd.Series(np.nan, index=df.index)
            X[c] = np.log1p(ug.fillna(med.get("UGDS", 0.0)))
        elif c in df.columns:
            X[c] = to_num(df[c])
        else:
            X[c] = np.nan
        X[c] = X[c].fillna(med.get(c, 0.0))
    return X


def fit_retention_model(
    df: pd.DataFrame,
) -> tuple[pd.Series, pd.Series, dict]:
    """
    Predict retention_share for schools missing PSEO.
    SAT missingness is a feature — do not treat unknown SAT as the sample median.
    """
    train = df[df["retention_source"] == "pseo"].copy()
    feats = ["CONTROL", "ADM_RATE", "SAT_AVG", "sat_missing", "UGDS", "rpp_local"]
    sat_f = _sat_features(train)
    train = train.copy()
    train["sat_missing"] = sat_f["sat_missing"]
    for c in ["CONTROL", "ADM_RATE", "SAT_AVG", "UGDS", "rpp_local"]:
        if c in train.columns:
            train[c] = to_num(train[c])
        else:
            train[c] = np.nan
    train = train.dropna(subset=["retention_share", "CONTROL", "UGDS"])
    med = {
        c: float(train[c].median()) if c in train.columns and train[c].notna().any() else 0.0
        for c in feats
    }
    med["sat_missing"] = 0.0

    X = _design_matrix(train, feats, med)
    y = train["retention_share"].clip(0.05, 0.95)
    model = LinearRegression()
    r2_cv = float("nan")
    if len(train) >= 40:
        cv = min(5, max(2, len(train) // 20))
        scores = cross_val_score(model, X, y, cv=cv, scoring="r2")
        r2_cv = float(np.mean(scores))
    model.fit(X, y)

    all_x = _design_matrix(df, feats, med)
    pred = pd.Series(model.predict(all_x), index=df.index).clip(0.05, 0.95)

    out = to_num(df["retention_share"]) if "retention_share" in df.columns else pd.Series(np.nan, index=df.index)
    src = df["retention_source"].copy() if "retention_source" in df.columns else pd.Series(index=df.index, dtype=object)
    miss = out.isna()
    out = out.copy()
    src = src.copy()
    out.loc[miss] = pred.loc[miss]
    src.loc[miss] = "modeled"
    src = src.fillna("modeled")

    meta = {
        "r2_cv": r2_cv,
        "n_train": int(len(train)),
        "coef": dict(zip(feats, [float(x) for x in model.coef_])),
        "intercept": float(model.intercept_),
        "feature_medians": med,
    }
    return out, src, meta


def rpp_grad_two_dest(
    retention: pd.Series,
    rpp_local: pd.Series,
    rpp_national_pool: float,
) -> pd.Series:
    """§4.3 two-destination model (legacy sensitivity)."""
    s = retention.clip(0, 1)
    return (s * rpp_local + (1 - s) * rpp_national_pool).rename("rpp_grad")


def rpp_grad_destination(
    retention: pd.Series,
    rpp_local: pd.Series,
    home_div: pd.Series,
    dest_emp: pd.DataFrame,
    rpp_div: dict[int, float],
    leaver_pool: float,
) -> pd.Series:
    """
    Destination-weighted graduate RPP.

    Start from Census-division employment shares (PSEO geo_level=D).
    Reprice the in-state slice from the home-division average to campus-local
    RPP (stayers work near campus, not at the division mean).

    Schools with no destination employment fall back to:
        retention * rpp_local + (1 - retention) * leaver_pool
    where leaver_pool is the observed destination RPP of out-of-state graduates,
    not the national population average of 100.
    """
    idx = retention.index
    s = retention.reindex(idx).clip(0, 1)
    local = rpp_local.reindex(idx).astype(float)
    hd = pd.to_numeric(home_div.reindex(idx), errors="coerce")
    fallback = s.fillna(0.5) * local.fillna(100.0) + (1 - s.fillna(0.5)) * float(leaver_pool)

    dest = dest_emp.reindex(idx)
    for c in DIV_COLS:
        if c not in dest.columns:
            dest[c] = 0.0
    dest = dest[DIV_COLS].apply(pd.to_numeric, errors="coerce").fillna(0.0)
    tot = dest.sum(axis=1)
    has = tot > 0
    out = fallback.copy()
    if not has.any():
        return out.rename("rpp_grad")

    w = dest.loc[has].div(tot.loc[has], axis=0)
    div_vals = pd.Series({c: float(rpp_div.get(int(c), 100.0)) for c in DIV_COLS})
    rpp_raw = w.mul(div_vals, axis=1).sum(axis=1)

    hd_has = hd.loc[has]
    w_np = w.to_numpy(dtype=float)
    col_index = {int(c): i for i, c in enumerate(DIV_COLS)}
    hd_idx = hd_has.map(col_index).fillna(-1).astype(int).to_numpy()
    w_home = np.zeros(len(w_np))
    ok = (hd_idx >= 0) & (hd_idx < len(DIV_COLS))
    w_home[ok] = w_np[np.arange(len(w_np))[ok], hd_idx[ok]]

    rpp_home = hd_has.map(lambda d: float(rpp_div.get(int(d), 100.0)) if pd.notna(d) else 100.0).to_numpy(dtype=float)
    shift = np.minimum(s.loc[has].fillna(0).to_numpy(dtype=float), w_home)
    loc = local.loc[has].fillna(rpp_raw).to_numpy(dtype=float)
    out.loc[has] = rpp_raw.to_numpy(dtype=float) + shift * (loc - rpp_home)
    return out.rename("rpp_grad")


def _cache_fresh(cache, source) -> bool:
    from pathlib import Path

    cache, source = Path(cache), Path(source)
    return cache.exists() and source.exists() and cache.stat().st_mtime >= source.stat().st_mtime


def extract_pseo_destinations(max_rows: int | None = None) -> pd.DataFrame:
    """
    Bachelor's, all-CIP destination employment by Census division (geo_level=D).
    Industry rows are summed. Pooled grad_cohort=0000.

    Returns wide table: institution, opeid6, dest_1..dest_9, dest_emp_total.
    """
    if max_rows is None and _cache_fresh(PSEO_DEST_CACHE, PSEO_FLOWS):
        return pd.read_csv(PSEO_DEST_CACHE, dtype={"institution": str})

    usecols = [
        "inst_level", "institution", "degree_level", "cip_level",
        "geo_level", "geography", "grad_cohort", "y5_grads_emp",
    ]
    parts = []
    n = 0
    for chunk in pd.read_csv(
        PSEO_FLOWS,
        chunksize=500_000,
        usecols=usecols,
        low_memory=False,
        dtype={"institution": str, "geography": str, "degree_level": str, "grad_cohort": str},
    ):
        deg = pd.to_numeric(chunk["degree_level"], errors="coerce")
        cohort = _norm_cohort(chunk["grad_cohort"])
        m = chunk[
            (chunk["inst_level"] == "I")
            & (deg == 5)
            & (chunk["cip_level"] == "A")
            & (chunk["geo_level"] == "D")
            & (cohort == "0000")
        ]
        if len(m):
            m = m.copy()
            m["y5"] = to_num(m["y5_grads_emp"])
            m["div"] = pd.to_numeric(m["geography"], errors="coerce")
            g = m.dropna(subset=["div"]).groupby(["institution", "div"], as_index=False)["y5"].sum()
            parts.append(g)
        n += len(chunk)
        if max_rows and n >= max_rows:
            break
    if not parts:
        return pd.DataFrame(columns=["institution", "opeid6", "dest_emp_total"] + [f"dest_{d}" for d in DIV_COLS])

    dest = pd.concat(parts, ignore_index=True)
    dest["institution"] = dest["institution"].astype(str).str.zfill(8)
    dest["div"] = dest["div"].astype(int)
    dest = dest.groupby(["institution", "div"], as_index=False)["y5"].sum()
    wide = dest.pivot(index="institution", columns="div", values="y5").fillna(0.0)
    for d in DIV_COLS:
        if d not in wide.columns:
            wide[d] = 0.0
    wide = wide[DIV_COLS]
    wide.columns = [f"dest_{d}" for d in DIV_COLS]
    wide = wide.reset_index()
    wide["opeid6"] = wide["institution"].str[:6]
    wide["dest_emp_total"] = wide[[f"dest_{d}" for d in DIV_COLS]].sum(axis=1)
    wide = wide[wide["dest_emp_total"] > 0]
    if max_rows is None:
        PROCESSED.mkdir(parents=True, exist_ok=True)
        wide.to_csv(PSEO_DEST_CACHE, index=False)
    return wide


def dest_emp_frame(dest_wide: pd.DataFrame, index: pd.Index, opeid8: pd.Series) -> pd.DataFrame:
    """Align dest_1..dest_9 onto a school index via OPEID8."""
    if dest_wide is None or dest_wide.empty:
        return pd.DataFrame(0.0, index=index, columns=DIV_COLS)
    d = dest_wide.copy()
    d["institution"] = d["institution"].astype(str).str.zfill(8)
    d = d.drop_duplicates("institution")
    cols = {f"dest_{k}": k for k in DIV_COLS}
    src = d.set_index("institution")[list(cols)].rename(columns=cols)
    mapped = src.reindex(opeid8.astype(str).str.zfill(8).values)
    mapped.index = index
    return mapped.fillna(0.0)


def implied_leaver_pool(
    rpp_grad: pd.Series,
    retention: pd.Series,
    rpp_local: pd.Series,
    min_oos: float = 0.15,
) -> float:
    """Employment-unweighted mean destination RPP of out-of-state graduates."""
    s = retention.clip(0.01, 0.99)
    oos = 1 - s
    ok = (oos >= min_oos) & rpp_grad.notna() & rpp_local.notna()
    if ok.sum() < 20:
        return 104.0
    implied = (rpp_grad[ok] - s[ok] * rpp_local[ok]) / oos[ok]
    implied = implied.replace([np.inf, -np.inf], np.nan).dropna()
    implied = implied.clip(85, 130)
    if implied.empty:
        return 104.0
    return float(implied.median())


def two_dest_log_rmse_cv(
    observed: pd.Series,
    retention: pd.Series,
    rpp_local: pd.Series,
    folds: int = 5,
) -> tuple[float, int]:
    """
    Held-out log error of the two-bucket estimator (in-state share at campus prices,
    leavers at the implied leaver pool), scored against destination-based price levels
    where both are observed. The leaver pool is re-estimated without each fold.
    """
    ok = observed.notna() & retention.notna() & rpp_local.notna()
    idx = observed.index[ok]
    if len(idx) < 40:
        return float("nan"), int(len(idx))
    fold = pd.Series(np.arange(len(idx)) % folds, index=idx)
    errs = []
    for f in range(folds):
        train, test = idx[fold != f], idx[fold == f]
        pool = implied_leaver_pool(observed[train], retention[train], rpp_local[train])
        pred = rpp_grad_two_dest(retention[test], rpp_local[test], pool)
        errs.append(np.log(pred) - np.log(observed[test]))
    e = pd.concat(errs)
    return float(np.sqrt((e ** 2).mean())), int(len(idx))


def fit_rpp_grad_model(
    df: pd.DataFrame,
    observed: pd.Series,
) -> tuple[pd.Series, pd.Series, dict]:
    """
    Predict rpp_grad where destinations are not observed.
    Train only on PSEO-destination schools. SAT missingness is a feature.
    """
    y = observed.reindex(df.index)
    train_mask = y.notna()
    feats = ["CONTROL", "ADM_RATE", "SAT_AVG", "sat_missing", "UGDS", "rpp_local"]
    train = df.loc[train_mask].copy()
    train["sat_missing"] = _sat_features(train)["sat_missing"]
    for c in ["CONTROL", "ADM_RATE", "SAT_AVG", "UGDS", "rpp_local"]:
        if c in train.columns:
            train[c] = to_num(train[c])
        else:
            train[c] = np.nan
    train = train.dropna(subset=["CONTROL", "UGDS", "rpp_local"])
    y_train = y.loc[train.index]
    med = {
        c: float(train[c].median()) if c in train.columns and train[c].notna().any() else 0.0
        for c in feats
    }
    med["sat_missing"] = 0.0
    X = _design_matrix(train, feats, med)
    model = LinearRegression()
    r2_cv = float("nan")
    log_rmse_cv = float("nan")
    if len(train) >= 40:
        cv = min(5, max(2, len(train) // 20))
        scores = cross_val_score(model, X, y_train, cv=cv, scoring="r2")
        r2_cv = float(np.mean(scores))
        held_out = cross_val_predict(model, X, y_train, cv=cv)
        log_rmse_cv = float(np.sqrt(np.mean((np.log(held_out) - np.log(y_train)) ** 2)))
    model.fit(X, y_train)

    pred = pd.Series(model.predict(_design_matrix(df, feats, med)), index=df.index)
    lo, hi = float(y_train.quantile(0.01)), float(y_train.quantile(0.99))
    pred = pred.clip(min(85.0, lo), max(125.0, hi))

    out = y.copy()
    src = pd.Series(np.where(y.notna(), "pseo_dest", None), index=df.index, dtype=object)
    miss = out.isna()
    out.loc[miss] = pred.loc[miss]
    src.loc[miss] = "modeled"
    src = src.fillna("modeled")

    meta = {
        "r2_cv": r2_cv,
        "log_rmse_cv": log_rmse_cv,
        "n_train": int(len(train)),
        "coef": dict(zip(feats, [float(x) for x in model.coef_])),
        "intercept": float(model.intercept_),
        "feature_medians": med,
        "pred_clip": [min(85.0, lo), max(125.0, hi)],
    }
    return out.rename("rpp_grad"), src.rename("rpp_source"), meta
