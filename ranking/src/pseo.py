"""PSEO graduate destination weights and retention model (§4.2–4.3)."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import cross_val_score

from config import PSEO_FLOWS, PSEO_INST
from util import opeid6, opeid8, to_num


def load_pseo_institutions() -> pd.DataFrame:
    df = pd.read_csv(PSEO_INST)
    # strip BOM
    df.columns = [c.lstrip("\ufeff") for c in df.columns]
    df["institution"] = df["institution"].astype(str).str.zfill(8)
    df["opeid6"] = df["institution"].str[:6]
    return df


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


def fit_retention_model(
    df: pd.DataFrame,
) -> tuple[pd.Series, pd.Series, dict]:
    """
    Predict retention_share for schools missing PSEO.
    Predictors: CONTROL, ADM_RATE, SAT_AVG, UGDS, rpp_local (metro cost proxy).
    """
    train = df[df["retention_source"] == "pseo"].copy()
    feats = ["CONTROL", "ADM_RATE", "SAT_AVG", "UGDS", "rpp_local"]
    for c in feats:
        if c in train.columns:
            train[c] = to_num(train[c])
        else:
            train[c] = np.nan
    train = train.dropna(subset=["retention_share", "CONTROL", "UGDS"])
    med = {c: float(train[c].median()) if train[c].notna().any() else 0.0 for c in feats}
    for c in feats:
        train[c] = train[c].fillna(med[c])

    X = train[feats]
    y = train["retention_share"].clip(0.05, 0.95)
    model = LinearRegression()
    r2_cv = float("nan")
    if len(train) >= 40:
        cv = min(5, max(2, len(train) // 20))
        scores = cross_val_score(model, X, y, cv=cv, scoring="r2")
        r2_cv = float(np.mean(scores))
    model.fit(X, y)

    all_x = pd.DataFrame({c: to_num(df[c]) if c in df.columns else np.nan for c in feats}, index=df.index)
    for c in feats:
        all_x[c] = all_x[c].fillna(med[c])
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
    """§4.3 two-destination model."""
    s = retention.clip(0, 1)
    return s * rpp_local + (1 - s) * rpp_national_pool
