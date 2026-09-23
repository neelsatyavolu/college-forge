"""Convert each Scorecard earnings field from its documented dollar year to REFERENCE_YEAR.

Dollar years differ by field and release (FieldOfStudy_Cohort_Map and
Most_Recent_Inst_Cohort_Map in the Scorecard data dictionary). Applying one
guessed base year to every field double-inflated the 4-year figures in v2.0.
"""
from __future__ import annotations

from functools import lru_cache

import pandas as pd

from config import FIELD_DOLLAR_YEAR, PCE_CSV, REFERENCE_YEAR
from geo import load_pce_deflator


@lru_cache(maxsize=None)
def factor(field: str) -> float:
    """Multiplier from the field's source dollar year to REFERENCE_YEAR dollars."""
    year = FIELD_DOLLAR_YEAR[field]
    if year == REFERENCE_YEAR:
        return 1.0
    return load_pce_deflator(PCE_CSV, earnings_year=year, ref_year=REFERENCE_YEAR)


def to_reference_dollars(df: pd.DataFrame, fields: list[str]) -> pd.DataFrame:
    """Return a copy with every listed field restated in REFERENCE_YEAR dollars."""
    return df.assign(**{f: df[f] * factor(f) for f in fields if f in df.columns})


def factors_used() -> dict[str, float]:
    return {f: factor(f) for f in FIELD_DOLLAR_YEAR}
