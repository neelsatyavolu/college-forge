"""BEA RPP, campus-local RPP, graduate-weighted deflator helpers."""
from __future__ import annotations

import numpy as np
import pandas as pd

from config import (
    CBSA_XLSX,
    COUNTY_CENTROIDS,
    COUNTY_POP,
    MARPP_CSV,
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


def load_rpp_tables() -> tuple[pd.DataFrame, pd.DataFrame, float]:
    """Return metro RPP (cbsa→rpp), state RPP (stfips→rpp), national nonmetro RPP."""
    mar = pd.read_csv(MARPP_CSV)
    mar = mar[mar["LineCode"] == 1.0].copy()
    mar["GeoFIPS"] = _clean_geofips(mar["GeoFIPS"])
    mar["rpp"] = to_num(mar[RPP_YEAR])
    mar = mar.dropna(subset=["rpp"])
    metro = mar[~mar["GeoFIPS"].isin(["00000", "00999"])][["GeoFIPS", "rpp", "GeoName"]].rename(
        columns={"GeoFIPS": "cbsa"}
    )
    nonmetro_us = float(mar.loc[mar["GeoFIPS"] == "00999", "rpp"].iloc[0])

    sar = pd.read_csv(SARPP_CSV)
    sar = sar[sar["LineCode"] == 1.0].copy()
    sar["GeoFIPS"] = _clean_geofips(sar["GeoFIPS"])
    sar["rpp"] = to_num(sar[RPP_YEAR])
    sar = sar.dropna(subset=["rpp"])
    # state FIPS are like 01000 → 01
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

    metro, state, nonmetro_us = load_rpp_tables()
    metro_rpp = metro.set_index("cbsa")["rpp"]
    state_rpp = state.set_index("stfips")["rpp"]

    df = cen.merge(pop, on="fips", how="left")
    df["pop"] = df["pop"].fillna(df["pop_cen"]).fillna(0)
    df = df.merge(cbsa[["fips", "cbsa"]], on="fips", how="left")
    df["rpp_metro"] = df["cbsa"].map(metro_rpp)
    df["rpp_state"] = df["stfips"].map(state_rpp)
    # County RPP: metro if in CBSA with RPP, else state (approx nonmetro portion of state)
    df["rpp_county"] = df["rpp_metro"].fillna(df["rpp_state"]).fillna(nonmetro_us)
    df["nonmetro_us_rpp"] = nonmetro_us
    return df, metro, state, nonmetro_us


def campus_local_rpp(
    schools: pd.DataFrame,
    counties: pd.DataFrame,
    radius_mi: float = 40.0,
) -> pd.Series:
    """Population-weighted mean county RPP within radius of each campus."""
    clat = counties["lat"].to_numpy()
    clon = counties["lon"].to_numpy()
    cpop = counties["pop"].to_numpy(dtype=float)
    crpp = counties["rpp_county"].to_numpy(dtype=float)

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
