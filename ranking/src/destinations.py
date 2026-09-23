"""Graduate cost of living (RPP_grad) for every institution in any ranking.

Stayers are priced near campus; movers at Census-division destinations from PSEO,
or a modeled mix where PSEO is absent. Logic unchanged from v1.2; it now runs on
the union of the overall and per-major universes so master's-only and
non-predominantly-bachelor's schools get the same treatment.
"""
from __future__ import annotations

import pandas as pd

from config import RADIUS_MI_DEFAULT
from geo import (
    STATE_FIPS,
    campus_local_rpp,
    division_rpp_map,
    home_division,
    load_county_table,
)
from pseo import (
    dest_emp_frame,
    extract_pseo_destinations,
    extract_pseo_retention,
    fit_retention_model,
    fit_rpp_grad_model,
    implied_leaver_pool,
    match_pseo_to_scorecard,
    rpp_grad_destination,
    rpp_grad_two_dest,
)
from util import opeid8


def _division_rpp(counties: pd.DataFrame) -> tuple[dict, dict]:
    fips_to_st = {v: k for k, v in STATE_FIPS.items()}
    st_pop = counties.groupby("stfips")["pop"].sum()
    st_young = counties.groupby("stfips")["rpp_state_young"].median()
    young, pop = {}, {}
    for fips, r in st_young.items():
        ab = fips_to_st.get(str(fips).zfill(2))
        if ab:
            young[ab] = float(r)
            pop[ab] = float(st_pop.get(fips, 1.0))
    return young, division_rpp_map(young, pop)


def graduate_rpp(schools: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """
    schools: institution rows (UNITID, OPEID, STABBR, LATITUDE, LONGITUDE, CONTROL,
    ADM_RATE, SAT_AVG, UGDS). Returns UNITID-indexed rpp_grad, rpp_local, rpp_source
    and retention_share, plus diagnostics.
    """
    df = schools.reset_index(drop=True).copy()
    counties, _, _, _ = load_county_table()
    st_young, div_rpp = _division_rpp(counties)

    df["rpp_local"] = df["UNITID"].map(campus_local_rpp(df, counties, radius_mi=RADIUS_MI_DEFAULT))
    df["rpp_local"] = df["rpp_local"].fillna(df["STABBR"].map(st_young)).fillna(100.0)
    df["home_div"] = df["STABBR"].map(home_division)

    matched = match_pseo_to_scorecard(df, extract_pseo_retention())
    df["retention_share"] = matched["retention_share"].values
    df["retention_source"] = matched["retention_source"].values
    n_pseo = int((df["retention_source"] == "pseo").sum())

    dest = dest_emp_frame(extract_pseo_destinations(), df.index, df["OPEID"].map(opeid8))
    has_dest = dest.sum(axis=1) > 0

    ret, src, ret_meta = fit_retention_model(df)
    df["retention_share"] = ret.values
    df["retention_source"] = src.values

    def dest_rpp(pool: float) -> pd.Series:
        return rpp_grad_destination(
            df["retention_share"], df["rpp_local"], df["home_div"], dest, div_rpp, leaver_pool=pool
        ).where(has_dest)

    leaver_pool = implied_leaver_pool(dest_rpp(104.0), df["retention_share"], df["rpp_local"])
    rpp_grad, rpp_src, rpp_meta = fit_rpp_grad_model(df, dest_rpp(leaver_pool))
    df["rpp_grad"] = rpp_grad.values
    df["rpp_source"] = rpp_src.values
    # PSEO in-state share but no destination rows: two-bucket with the leaver pool, not 100
    instate_only = (df["retention_source"] == "pseo") & (df["rpp_source"] == "modeled")
    df.loc[instate_only, "rpp_grad"] = rpp_grad_two_dest(
        df.loc[instate_only, "retention_share"], df.loc[instate_only, "rpp_local"], leaver_pool
    ).values
    df.loc[instate_only, "rpp_source"] = "pseo_instate"

    diag = {
        "n_schools": int(len(df)),
        "n_pseo_retention": n_pseo,
        "n_pseo_destinations": int(has_dest.sum()),
        "modeled_share": float((df["rpp_source"] == "modeled").mean()),
        "retention_model": ret_meta,
        "rpp_grad_model": rpp_meta,
        "leaver_pool_rpp": float(leaver_pool),
        "division_rpp": {str(k): v for k, v in div_rpp.items()},
    }
    cols = ["UNITID", "rpp_grad", "rpp_local", "rpp_source", "retention_share", "retention_source"]
    return df[cols].set_index("UNITID"), diag
