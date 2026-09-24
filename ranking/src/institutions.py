"""Institution records and ranking universes (§2)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from config import CONTROL_ALLOWED, INST_CSV, PREDDEG_BACHELORS, UGDS_MIN
from dollars import to_reference_dollars
from geo import STATE_TO_DIVISION
from util import to_num

# 50 states + DC. Territories have no BEA price parities and separate labor markets,
# so their graduates cannot be compared fairly against mainland national medians.
PRICED_STATES = set(STATE_TO_DIVISION)

INST_COLS = [
    "UNITID", "OPEID", "OPEID6", "INSTNM", "CITY", "STABBR", "CONTROL", "MAIN",
    "PREDDEG", "CURROPER", "DISTANCEONLY", "UGDS", "LATITUDE", "LONGITUDE",
    "CCBASIC", "ADM_RATE", "SAT_AVG", "ACTCMMID", "C150_4", "C150_4_PELL", "D150_4_PELL", "PCTPELL", "FIRST_GEN",
    "MD_EARN_WNE_P10", "COUNT_WNE_P10", "COUNT_WNE_3YR", "COUNT_NWNE_3YR",
    "NPT4_PUB", "NPT4_PRIV", "COSTT4_A", "INSTURL",
]
NUMERIC = [c for c in INST_COLS if c not in {"INSTNM", "CITY", "STABBR", "INSTURL"}]


def load_institutions() -> pd.DataFrame:
    df = pd.read_csv(INST_CSV, usecols=lambda c: c in INST_COLS, low_memory=False)
    for c in NUMERIC:
        if c in df.columns:
            df[c] = to_num(df[c])
    df["net_price"] = df["NPT4_PUB"].fillna(df["NPT4_PRIV"])
    return to_reference_dollars(df, ["MD_EARN_WNE_P10"])


def _exclusion_rows(inst: pd.DataFrame, mask: pd.Series, reason: str, field: str) -> pd.DataFrame:
    sub = inst.loc[mask, ["UNITID", "INSTNM", "STABBR"]].copy()
    sub["reason"] = reason
    sub["field"] = field
    sub["failing_value"] = inst.loc[mask, field].astype(str).values
    return sub


def apply_eligibility(inst: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Overall-ranking universe. Returns (eligible, exclusions with the first failing rule)."""
    rules = [
        (inst["PREDDEG"] != PREDDEG_BACHELORS, "not_predominantly_bachelors", "PREDDEG"),
        (~inst["CONTROL"].isin(CONTROL_ALLOWED), "for_profit_or_other_control", "CONTROL"),
        (inst["CURROPER"] != 1, "not_currently_operating", "CURROPER"),
        (inst["MAIN"] != 1, "not_main_campus", "MAIN"),
        (inst["UGDS"].fillna(0) < UGDS_MIN, f"undergrads_below_{UGDS_MIN}", "UGDS"),
        (inst["DISTANCEONLY"] == 1, "distance_only", "DISTANCEONLY"),
        (~inst["STABBR"].isin(PRICED_STATES), "territory_no_price_data", "STABBR"),
    ]
    keep = pd.Series(True, index=inst.index)
    parts = []
    for mask, reason, field in rules:
        hit = mask & keep
        if hit.any():
            parts.append(_exclusion_rows(inst, hit, reason, field))
        keep = keep & ~mask
    exclusions = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(
        columns=["UNITID", "INSTNM", "STABBR", "reason", "field", "failing_value"]
    )
    return inst.loc[keep].copy(), exclusions


def major_universe(inst: pd.DataFrame) -> pd.DataFrame:
    """Per-major universe: any operating public or nonprofit school in a state or DC, not online-only."""
    ok = (
        inst["CONTROL"].isin(CONTROL_ALLOWED)
        & (inst["CURROPER"] == 1)
        & (inst["DISTANCEONLY"] != 1)
        & inst["STABBR"].isin(PRICED_STATES)
    )
    return inst.loc[ok].copy()


def employment_rate(inst: pd.DataFrame) -> pd.Series:
    """
    Working share among graduates not enrolled, 3 years after completion.

    The 10-years-after-entry counts are not used: they mark many graduates as
    "not working" (e.g. 38% working at Babson vs 96% of its graduates at year 3),
    which tracks self-employment and life abroad more than career access.
    """
    wne = inst["COUNT_WNE_3YR"]
    nwne = inst["COUNT_NWNE_3YR"]
    denom = (wne + nwne).replace(0, np.nan)
    return (wne / denom).rename("employment_rate")
