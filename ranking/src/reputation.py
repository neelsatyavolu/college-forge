"""Reputation composite: yield + research (OpenAlex) + outcomes (§5)."""
from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from tqdm import tqdm

from config import ADM_CSV, OPENALEX_MAILTO, PROCESSED, REP_WEIGHTS
from util import pctile_rank, to_num


def load_yield() -> pd.Series:
    """Yield = ENRLT / ADMSSN from IPEDS ADM2023."""
    adm = pd.read_csv(ADM_CSV, encoding="latin-1", low_memory=False)
    adm["ADMSSN"] = to_num(adm["ADMSSN"])
    adm["ENRLT"] = to_num(adm["ENRLT"])
    adm["yield_rate"] = adm["ENRLT"] / adm["ADMSSN"].replace(0, np.nan)
    # Clip absurd values
    adm["yield_rate"] = adm["yield_rate"].clip(0, 1)
    return adm.set_index("UNITID")["yield_rate"]


def _openalex_one(session: requests.Session, uid: int, name: str) -> dict:
    fwci = np.nan
    h = np.nan
    try:
        r = session.get(
            "https://api.openalex.org/institutions",
            params={"search": name, "filter": "country_code:US", "per_page": 5},
            timeout=25,
        )
        if r.status_code == 429:
            time.sleep(2.5)
            r = session.get(
                "https://api.openalex.org/institutions",
                params={"search": name, "filter": "country_code:US", "per_page": 5},
                timeout=25,
            )
        if r.status_code == 200:
            results = r.json().get("results") or []
            best = None
            name_l = name.lower().replace("&", "and")
            for cand in results:
                dn = (cand.get("display_name") or "").lower().replace("&", "and")
                if dn == name_l or name_l in dn or dn in name_l:
                    best = cand
                    break
            if best is None and results:
                best = results[0]
            if best:
                stats = best.get("summary_stats") or {}
                fwci = stats.get("2yr_mean_citedness")
                h = stats.get("h_index")
    except Exception:
        pass
    return {"UNITID": uid, "fwci": fwci, "h_index": h, "query": name}


def fetch_openalex_research(schools: pd.DataFrame, cache_path: Path | None = None) -> pd.Series:
    """
    Field-weighted citation impact (2yr mean citedness) from OpenAlex, matched by name.
    Returns research score; Carnegie-within-percentile applied later.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    cache_path = cache_path or (PROCESSED / "openalex_research.csv")
    cache_path.parent.mkdir(parents=True, exist_ok=True)

    cached = pd.DataFrame()
    if cache_path.exists():
        cached = pd.read_csv(cache_path)
        have = set(cached["UNITID"].tolist())
        need = schools[~schools["UNITID"].isin(have)]
        if len(need) == 0:
            print(f"  OpenAlex cache complete: {cache_path} ({len(cached)} rows)")
            return cached.set_index("UNITID")["fwci"]
        print(f"  OpenAlex cache partial: {len(have)} done, {len(need)} remaining")
    else:
        need = schools

    headers = {"User-Agent": f"college-pp-ranking/1.0 ({OPENALEX_MAILTO})"}
    rows = []

    def worker(item):
        uid, name = item
        sess = requests.Session()
        sess.headers.update(headers)
        return _openalex_one(sess, uid, name)

    items = [(int(r.UNITID), str(r.INSTNM)) for r in need.itertuples()]
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = [ex.submit(worker, it) for it in items]
        for fut in tqdm(as_completed(futs), total=len(futs), desc="OpenAlex"):
            rows.append(fut.result())

    new = pd.DataFrame(rows)
    out = pd.concat([cached, new], ignore_index=True).drop_duplicates("UNITID", keep="last")
    out.to_csv(cache_path, index=False)
    print(f"  wrote OpenAlex cache {cache_path} ({len(out)} rows)")
    return out.set_index("UNITID")["fwci"]


def research_within_carnegie(fwci: pd.Series, ccbasic: pd.Series) -> pd.Series:
    """§5.3(a): percentile within Carnegie class."""
    df = pd.DataFrame({"fwci": fwci, "cc": ccbasic})
    # Missing Carnegie → global percentile among non-null
    def rank_group(s):
        return pctile_rank(s)

    out = df.groupby("cc", dropna=False)["fwci"].transform(rank_group)
    # Schools with no research score: leave NA (will impute to median of class later)
    return out.rename("research_pctile")


def outcomes_score(ret_ft4: pd.Series, c150_4: pd.Series) -> pd.Series:
    """Average of retention and 6yr completion percentiles."""
    a = pctile_rank(ret_ft4)
    b = pctile_rank(c150_4)
    return ((a + b) / 2.0).rename("outcomes_pctile")


def reputation_composite(
    yield_rate: pd.Series,
    research_pctile: pd.Series,
    outcomes_pctile: pd.Series,
    weights: dict | None = None,
) -> pd.Series:
    w = weights or REP_WEIGHTS
    y = pctile_rank(yield_rate)
    # research already a percentile within class
    r = research_pctile
    o = outcomes_pctile
    # Impute missing components with cross-sectional median of available
    y = y.fillna(y.median())
    r = r.fillna(r.median())
    o = o.fillna(o.median())
    score = w["yield"] * y + w["research"] * r + w["outcomes"] * o
    return score.rename("reputation_raw")
