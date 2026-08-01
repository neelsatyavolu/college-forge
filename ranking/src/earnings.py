"""Field-of-study earnings aggregation (§3)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from config import (
    COHORT_FLOOR,
    CONTROL_ALLOWED,
    COVERAGE_FOS,
    COVERAGE_INST_FLOOR,
    FOS_CSV,
    INST_CSV,
    PREDDEG_BACHELORS,
    UGDS_MIN,
)
from util import to_num


INST_COLS = [
    "UNITID", "OPEID", "OPEID6", "INSTNM", "CITY", "STABBR", "CONTROL", "MAIN",
    "PREDDEG", "CURROPER", "DISTANCEONLY", "UGDS", "LATITUDE", "LONGITUDE",
    "CCBASIC", "ADM_RATE", "SAT_AVG", "ACTCMMID", "RET_FT4", "C150_4",
    "PCTPELL", "PCTFLOAN", "FIRST_GEN", "MD_EARN_WNE_4YR", "MD_EARN_WNE_P10",
    "COUNT_WNE_4YR", "COUNT_NWNE_4YR", "NPT4_PUB", "NPT4_PRIV", "COSTT4_A",
    "REGION", "LOCALE",
]


def load_institutions() -> pd.DataFrame:
    df = pd.read_csv(INST_CSV, usecols=lambda c: c in INST_COLS, low_memory=False)
    for c in [
        "CONTROL", "MAIN", "PREDDEG", "CURROPER", "DISTANCEONLY", "UGDS",
        "LATITUDE", "LONGITUDE", "CCBASIC", "ADM_RATE", "SAT_AVG", "ACTCMMID",
        "RET_FT4", "C150_4", "PCTPELL", "PCTFLOAN", "FIRST_GEN",
        "MD_EARN_WNE_4YR", "MD_EARN_WNE_P10", "COUNT_WNE_4YR", "COUNT_NWNE_4YR",
        "NPT4_PUB", "NPT4_PRIV", "COSTT4_A", "REGION", "OPEID", "OPEID6",
    ]:
        if c in df.columns:
            df[c] = to_num(df[c])
    df["net_price"] = df["NPT4_PUB"].fillna(df["NPT4_PRIV"])
    return df


def apply_eligibility(inst: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return (eligible, exclusions)."""
    rows = []
    keep = np.ones(len(inst), dtype=bool)

    def fail(mask, reason, field, value_series=None):
        nonlocal keep
        hit = mask & keep
        if hit.any():
            sub = inst.loc[hit, ["UNITID", "INSTNM", "STABBR"]].copy()
            sub["reason"] = reason
            sub["field"] = field
            if value_series is not None:
                sub["failing_value"] = value_series.loc[hit].astype(str).values
            else:
                sub["failing_value"] = ""
            rows.append(sub)
            keep = keep & ~mask

    fail(inst["PREDDEG"] != PREDDEG_BACHELORS, "not_predominantly_bachelors", "PREDDEG", inst["PREDDEG"])
    fail(~inst["CONTROL"].isin(CONTROL_ALLOWED), "for_profit_or_other_control", "CONTROL", inst["CONTROL"])
    fail(inst["CURROPER"] != 1, "not_currently_operating", "CURROPER", inst["CURROPER"])
    fail(inst["MAIN"] != 1, "not_main_campus", "MAIN", inst["MAIN"])
    fail(inst["UGDS"].fillna(0) < UGDS_MIN, "ugds_below_500", "UGDS", inst["UGDS"])
    fail(inst["DISTANCEONLY"] == 1, "distance_only", "DISTANCEONLY", inst["DISTANCEONLY"])

    exclusions = pd.concat(rows, ignore_index=True) if rows else pd.DataFrame(
        columns=["UNITID", "INSTNM", "STABBR", "reason", "field", "failing_value"]
    )
    eligible = inst.loc[keep].copy()
    return eligible, exclusions


def load_fos_bachelors() -> pd.DataFrame:
    usecols = [
        "UNITID", "INSTNM", "CONTROL", "MAIN", "CIPCODE", "CIPDESC", "CREDLEV",
        "IPEDSCOUNT1", "IPEDSCOUNT2", "EARN_MDN_4YR", "EARN_COUNT_WNE_4YR",
        "EARN_COUNT_NWNE_4YR", "EARN_MDN_4YR_NAT",
    ]
    df = pd.read_csv(FOS_CSV, usecols=usecols, low_memory=False)
    df = df[df["CREDLEV"] == 3].copy()  # bachelor's
    df["CIPCODE"] = df["CIPCODE"].astype(str).str.replace(r"\.0$", "", regex=True).str.zfill(4)
    df["completions"] = (
        to_num(df["IPEDSCOUNT1"]).fillna(0) + to_num(df["IPEDSCOUNT2"]).fillna(0)
    ) / 2.0
    # Some releases only populate one count year
    one = to_num(df["IPEDSCOUNT1"]).fillna(to_num(df["IPEDSCOUNT2"]))
    df.loc[df["completions"] == 0, "completions"] = one.loc[df["completions"] == 0].fillna(0)
    df["earnings_4yr"] = to_num(df["EARN_MDN_4YR"])
    df["earn_n"] = to_num(df["EARN_COUNT_WNE_4YR"])
    df["nwne_n"] = to_num(df["EARN_COUNT_NWNE_4YR"])
    df["nat_earn_4yr"] = to_num(df["EARN_MDN_4YR_NAT"])
    return df


def aggregate_school_earnings(
    fos: pd.DataFrame,
    eligible_ids: set[int],
    cohort_floor: int = COHORT_FLOOR,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Returns:
      school_metrics: one row per school with E_actual, coverage, etc.
      cip_scored: CIP rows that cleared the floor (for per-major ranking)
      exclusions_extra: schools dropped for low coverage
    """
    fos = fos[fos["UNITID"].isin(eligible_ids)].copy()

    # Total bachelor's completions per school (all CIPs, before floor)
    total_comp = fos.groupby("UNITID")["completions"].sum().rename("total_bach_completions")

    # National CIP weights (among CIPs with any completions)
    nat = fos.groupby("CIPCODE")["completions"].sum()
    nat_w = (nat / nat.sum()).rename("w_national")

    # Cohort floor + unsuppressed earnings
    scored = fos[(fos["completions"] >= cohort_floor) & fos["earnings_4yr"].notna()].copy()
    scored = scored.merge(nat_w, left_on="CIPCODE", right_index=True, how="left")

    # Actual-mix
    scored["wx"] = scored["completions"] * scored["earnings_4yr"]
    g = scored.groupby("UNITID")
    e_actual = (g["wx"].sum() / g["completions"].sum()).rename("earnings_actual_mix")
    e_fixed_num = g.apply(lambda d: (d["w_national"] * d["earnings_4yr"]).sum(), include_groups=False)
    e_fixed_den = g["w_national"].sum()
    e_fixed = (e_fixed_num / e_fixed_den).rename("earnings_fixed_mix")

    scored_comp = g["completions"].sum().rename("scored_completions")
    n_cips = g.size().rename("n_cips_scored")
    # top5 share of total completions
    def top5_share(d):
        t = d["completions"].sum()
        if t <= 0:
            return np.nan
        return d.nlargest(5, "completions")["completions"].sum() / t

    top5 = g.apply(top5_share, include_groups=False).rename("top5_share")

    metrics = pd.concat([e_actual, e_fixed, scored_comp, n_cips, top5], axis=1)
    metrics = metrics.join(total_comp, how="right")
    metrics["fos_coverage"] = metrics["scored_completions"] / metrics["total_bach_completions"].replace(0, np.nan)
    metrics = metrics.reset_index()

    # Coverage rules
    exclusions = []
    metrics["earnings_source"] = "field_of_study"
    low = metrics["fos_coverage"].fillna(0) < COVERAGE_INST_FLOOR
    mid = (metrics["fos_coverage"].fillna(0) >= COVERAGE_INST_FLOOR) & (
        metrics["fos_coverage"].fillna(0) < COVERAGE_FOS
    )
    # high coverage: keep FoS
    metrics.loc[mid, "earnings_source"] = "institution"  # will fill from inst later
    metrics.loc[mid, "earnings_actual_mix"] = np.nan  # mark for inst fill
    for _, r in metrics.loc[low].iterrows():
        exclusions.append({
            "UNITID": r["UNITID"],
            "INSTNM": "",
            "STABBR": "",
            "reason": "fos_coverage_below_0.30",
            "field": "fos_coverage",
            "failing_value": f"{r['fos_coverage']:.3f}" if pd.notna(r["fos_coverage"]) else "nan",
        })
    metrics = metrics.loc[~low].copy()

    return metrics, scored, pd.DataFrame(exclusions)


def fill_institution_earnings(metrics: pd.DataFrame, inst: pd.DataFrame) -> pd.DataFrame:
    m = metrics.merge(
        inst[["UNITID", "MD_EARN_WNE_4YR", "MD_EARN_WNE_P10", "COUNT_WNE_4YR", "COUNT_NWNE_4YR"]],
        on="UNITID",
        how="left",
    )
    use_inst = m["earnings_source"] == "institution"
    m.loc[use_inst, "earnings_actual_mix"] = m.loc[use_inst, "MD_EARN_WNE_4YR"]
    # If FoS missing actual but inst available and coverage mid, already handled.
    # Drop schools still missing actual mix
    m["earnings_10yr"] = m["MD_EARN_WNE_P10"]
    return m


def grad_feeder_rate(inst: pd.DataFrame) -> pd.Series:
    """Share not working at 4yr measurement — proxy for further education (§3.6)."""
    wne = to_num(inst["COUNT_WNE_4YR"])
    nwne = to_num(inst["COUNT_NWNE_4YR"])
    denom = wne.fillna(0) + nwne.fillna(0)
    rate = nwne / denom.replace(0, np.nan)
    return rate.rename("grad_feeder_rate")
