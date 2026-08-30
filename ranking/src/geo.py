"""BEA RPP, campus-local RPP, graduate-weighted deflator helpers."""
from __future__ import annotations

import numpy as np
import pandas as pd

from config import (
    CBSA_XLSX,
    COUNTY_CENTROIDS,
    COUNTY_POP,
    HOUSING_EXTRA_WEIGHT,
    MARPP_CSV,
    RPP_LINE_ALL,
    RPP_LINE_HOUSING,
    RPP_YEAR,
    SARPP_CSV,
)
from util import haversine_mi, to_num


STATE_FIPS = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08",
    "CT": "09", "DE": "10", "DC": "11", "FL": "12", "GA": "13", "HI": "15",
    "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21",
    "LA": "22", "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27",
    "MS": "28", "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33",
    "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39",
    "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46",
    "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53",
    "WV": "54", "WI": "55", "WY": "56", "PR": "72",
}


def load_pce_deflator(pce_path, earnings_year: int, ref_year: int) -> float:
    """Factor to multiply nominal dollars from earnings_year into ref_year dollars."""
    pce = pd.read_csv(pce_path)
    pce.columns = [c.strip() for c in pce.columns]
    date_col = pce.columns[0]
    val_col = pce.columns[1]
    pce["year"] = pd.to_datetime(pce[date_col]).dt.year
    annual = pce.groupby("year")[val_col].mean()
    # Prefer Dec or latest annual; use yearly mean
    if earnings_year not in annual.index or ref_year not in annual.index:
        # fall back to last available
        ey = annual.index[annual.index <= earnings_year].max() if any(annual.index <= earnings_year) else annual.index.max()
        ry = annual.index[annual.index <= ref_year].max() if any(annual.index <= ref_year) else annual.index.max()
        return float(annual[ry] / annual[ey])
    return float(annual[ref_year] / annual[earnings_year])


def _clean_geofips(s: pd.Series) -> pd.Series:
    return s.astype(str).str.replace('"', "", regex=False).str.strip().str.zfill(5)


# Census divisions (PSEO geo_level=D geography codes 1–9)
STATE_TO_DIVISION: dict[str, int] = {
    "CT": 1, "ME": 1, "MA": 1, "NH": 1, "RI": 1, "VT": 1,
    "NJ": 2, "NY": 2, "PA": 2,
    "IL": 3, "IN": 3, "MI": 3, "OH": 3, "WI": 3,
    "IA": 4, "KS": 4, "MN": 4, "MO": 4, "NE": 4, "ND": 4, "SD": 4,
    "DE": 5, "DC": 5, "FL": 5, "GA": 5, "MD": 5, "NC": 5, "SC": 5, "VA": 5, "WV": 5,
    "AL": 6, "KY": 6, "MS": 6, "TN": 6,
    "AR": 7, "LA": 7, "OK": 7, "TX": 7,
    "AZ": 8, "CO": 8, "ID": 8, "MT": 8, "NM": 8, "NV": 8, "UT": 8, "WY": 8,
    "AK": 9, "CA": 9, "HI": 9, "OR": 9, "WA": 9,
}
DIVISION_STATES: dict[int, list[str]] = {}
for _st, _div in STATE_TO_DIVISION.items():
    DIVISION_STATES.setdefault(_div, []).append(_st)


def rpp_young(rpp_all, rpp_housing, extra_housing_weight: float = HOUSING_EXTRA_WEIGHT):
    """
    Reweight BEA all-items RPP toward housing.

    all-items already includes shelter. Adding extra_housing_weight * (housing − all)
    raises the shelter share by that many percentage points (young renter budgets).
    Missing housing falls back to all-items.
    """
    scalar = np.isscalar(rpp_all) and np.isscalar(rpp_housing)
    a = np.asarray(rpp_all, dtype=float)
    h = np.asarray(rpp_housing, dtype=float)
    h = np.where(np.isnan(h), a, h)
    out = a + extra_housing_weight * (h - a)
    if scalar:
        return float(np.reshape(out, -1)[0])
    return out


def _rpp_line(csv_path, line_code: float) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    df = df[df["LineCode"] == line_code].copy()
    df["GeoFIPS"] = _clean_geofips(df["GeoFIPS"])
    df["rpp"] = to_num(df[RPP_YEAR])
    return df.dropna(subset=["rpp"])


def load_rpp_tables(line_code: float = RPP_LINE_ALL) -> tuple[pd.DataFrame, pd.DataFrame, float]:
    """Return metro RPP (cbsa→rpp), state RPP (stfips→rpp), national nonmetro RPP."""
    mar = _rpp_line(MARPP_CSV, line_code)
    metro = mar[~mar["GeoFIPS"].isin(["00000", "00999"])][["GeoFIPS", "rpp", "GeoName"]].rename(
        columns={"GeoFIPS": "cbsa"}
    )
    nm = mar.loc[mar["GeoFIPS"] == "00999", "rpp"]
    nonmetro_us = float(nm.iloc[0]) if len(nm) else 100.0

    sar = _rpp_line(SARPP_CSV, line_code)
    sar["stfips"] = sar["GeoFIPS"].str[:2]
    state = sar[sar["GeoFIPS"] != "00000"][["stfips", "rpp", "GeoName"]]
    return metro, state, nonmetro_us


def load_county_table() -> pd.DataFrame:
    """Counties with centroid, population, CBSA, state RPP/metro RPP assignment."""
    cen = pd.read_csv(COUNTY_CENTROIDS)
    cen["stfips"] = cen["STATEFP"].astype(int).astype(str).str.zfill(2)
    cen["countyfp"] = cen["COUNTYFP"].astype(int).astype(str).str.zfill(3)
    cen["fips"] = cen["stfips"] + cen["countyfp"]
    cen = cen.rename(columns={"LATITUDE": "lat", "LONGITUDE": "lon", "POPULATION": "pop_cen"})

    # County population (more current)
    pop = pd.read_csv(COUNTY_POP, encoding="latin-1")
    # SUMLEV 50 = county
    if "SUMLEV" in pop.columns:
        pop = pop[pop["SUMLEV"] == 50]
    st = pop["STATE"].astype(int).astype(str).str.zfill(2)
    co = pop["COUNTY"].astype(int).astype(str).str.zfill(3)
    pop = pop.assign(fips=st + co)
    pop_col = "POPESTIMATE2023" if "POPESTIMATE2023" in pop.columns else [
        c for c in pop.columns if c.startswith("POPESTIMATE")
    ][-1]
    pop = pop[["fips", pop_col]].rename(columns={pop_col: "pop"})

    # CBSA delineation
    cbsa = pd.read_excel(CBSA_XLSX, skiprows=2)
    cbsa = cbsa.dropna(subset=["FIPS State Code", "FIPS County Code"])
    cbsa["stfips"] = cbsa["FIPS State Code"].astype(int).astype(str).str.zfill(2)
    cbsa["countyfp"] = cbsa["FIPS County Code"].astype(int).astype(str).str.zfill(3)
    cbsa["fips"] = cbsa["stfips"] + cbsa["countyfp"]
    # Prefer Metropolitan over Micropolitan if duplicates (shouldn't)
    cbsa["cbsa"] = cbsa["CBSA Code"].astype(int).astype(str).str.zfill(5)
    cbsa = cbsa[["fips", "cbsa", "Metropolitan/Micropolitan Statistical Area"]].drop_duplicates("fips")

    metro, state, nonmetro_us = load_rpp_tables(RPP_LINE_ALL)
    metro_h, state_h, nonmetro_h = load_rpp_tables(RPP_LINE_HOUSING)
    metro_rpp = metro.set_index("cbsa")["rpp"]
    state_rpp = state.set_index("stfips")["rpp"]
    metro_housing = metro_h.set_index("cbsa")["rpp"]
    state_housing = state_h.set_index("stfips")["rpp"]

    df = cen.merge(pop, on="fips", how="left")
    df["pop"] = df["pop"].fillna(df["pop_cen"]).fillna(0)
    df = df.merge(cbsa[["fips", "cbsa"]], on="fips", how="left")
    df["rpp_metro"] = df["cbsa"].map(metro_rpp)
    df["rpp_state"] = df["stfips"].map(state_rpp)
    df["rpp_metro_housing"] = df["cbsa"].map(metro_housing)
    df["rpp_state_housing"] = df["stfips"].map(state_housing)
    # County RPP: metro if in CBSA with RPP, else state (approx nonmetro portion of state)
    df["rpp_county_all"] = df["rpp_metro"].fillna(df["rpp_state"]).fillna(nonmetro_us)
    df["rpp_county_housing"] = (
        df["rpp_metro_housing"].fillna(df["rpp_state_housing"]).fillna(nonmetro_h)
    )
    df["rpp_county"] = rpp_young(df["rpp_county_all"], df["rpp_county_housing"])
    df["rpp_state_young"] = rpp_young(df["rpp_state"], df["rpp_state_housing"])
    df["nonmetro_us_rpp"] = float(rpp_young(nonmetro_us, nonmetro_h))
    return df, metro, state, nonmetro_us


def campus_local_rpp(
    schools: pd.DataFrame,
    counties: pd.DataFrame,
    radius_mi: float = 40.0,
    rpp_col: str = "rpp_county",
) -> pd.Series:
    """Population-weighted mean county RPP within radius of each campus."""
    clat = counties["lat"].to_numpy()
    clon = counties["lon"].to_numpy()
    cpop = counties["pop"].to_numpy(dtype=float)
    crpp = counties[rpp_col].to_numpy(dtype=float)

    out = {}
    for row in schools.itertuples():
        uid = row.UNITID
        lat, lon = row.LATITUDE, row.LONGITUDE
        if pd.isna(lat) or pd.isna(lon):
            # fall back to state
            st = getattr(row, "STABBR", None)
            out[uid] = np.nan
            continue
        d = haversine_mi(lat, lon, clat, clon)
        mask = d <= radius_mi
        if not mask.any():
            # nearest county
            j = int(np.argmin(d))
            out[uid] = float(crpp[j])
            continue
        w = cpop[mask]
        r = crpp[mask]
        if w.sum() <= 0:
            out[uid] = float(np.nanmean(r))
        else:
            out[uid] = float(np.average(r, weights=w))
    return pd.Series(out, name="rpp_local")


def state_rpp_map(state: pd.DataFrame) -> dict[str, float]:
    """STABBR → RPP."""
    inv = {v: k for k, v in STATE_FIPS.items()}
    m = {}
    for _, row in state.iterrows():
        ab = inv.get(row["stfips"])
        if ab:
            m[ab] = float(row["rpp"])
    return m


def stabbr_to_stfips(stabbr) -> str | None:
    if stabbr is None or (isinstance(stabbr, float) and np.isnan(stabbr)):
        return None
    return STATE_FIPS.get(str(stabbr).strip().upper())


def home_division(stabbr) -> float:
    st = str(stabbr).strip().upper() if stabbr is not None else ""
    d = STATE_TO_DIVISION.get(st)
    return float(d) if d else np.nan


def division_rpp_map(
    state_rpp_young: dict[str, float],
    state_pop: dict[str, float] | None = None,
) -> dict[int, float]:
    """Population-weighted young RPP per Census division. Keys are STABBR."""
    out: dict[int, float] = {}
    for div, states in DIVISION_STATES.items():
        rs, ws = [], []
        for st in states:
            r = state_rpp_young.get(st)
            if r is None or (isinstance(r, float) and np.isnan(r)):
                continue
            w = (state_pop or {}).get(st, 1.0)
            rs.append(float(r))
            ws.append(max(float(w), 1.0))
        if rs:
            out[div] = float(np.average(rs, weights=ws))
    return out
