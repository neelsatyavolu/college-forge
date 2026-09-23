"""Public JSON for /rankings and the recommendation engine."""
from __future__ import annotations

import json
import shutil

import numpy as np
import pandas as pd

from config import (
    MAJOR_TOP_N,
    METHODOLOGY_VERSION,
    OUT,
    OVERALL_TOP_N,
    OVERALL_WEIGHTS,
    PUBLIC_RANKINGS,
)


def _records(df: pd.DataFrame) -> list:
    return json.loads(df.to_json(orient="records", double_precision=4))


def _write(path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":")))


def _pct(log_ratio: pd.Series) -> pd.Series:
    return (np.exp(log_ratio) - 1.0) * 100.0


def school_rows(table: pd.DataFrame) -> pd.DataFrame:
    """table: scored schools with metadata columns attached."""
    out = pd.DataFrame({
        "rank": table["rank"],
        "rank_low": table["rank_low"],
        "rank_high": table["rank_high"],
        "unitid": table.index.astype(int),
        "institution": table["INSTNM"],
        "city": table["CITY"],
        "state": table["STABBR"],
        "control": table["CONTROL"].map({1: "public", 2: "private_nonprofit"}),
        "score": table["score"].round(1),
        "early_premium_pct": _pct(table["early_premium"]).round(1),
        "long_premium_pct": _pct(table["long_premium"]).round(1),
        "graduation_rate": table["graduation"].round(3),
        "employment_rate": table["employment"].round(3),
        "typical_salary": table["typical_salary"].round(-2),
        "salary_10yr": table["salary_10yr"].round(-2),
        "rpp_grad": table["rpp_grad"].round(1),
        "rpp_source": table["rpp_source"],
        "coverage": table["coverage"].round(2),
        "net_price": table["net_price"],
        "cost_of_attendance": table["COSTT4_A"],
        "pct_pell": table["PCTPELL"].round(3),
        "beats_expectations": table["beats_expectations"].round(1),
        "beats_rank": table["beats_rank"],
    })
    for c in ("early_premium", "long_premium", "graduation", "employment"):
        out[f"{c}_pctile"] = (table[c].rank(pct=True) * 100).round(0)
    return out


def major_rows(g: pd.DataFrame, overall_rank: pd.Series, pce: float) -> pd.DataFrame:
    return pd.DataFrame({
        "rank": g["rank"],
        "rank_low": g["rank_low"],
        "rank_high": g["rank_high"],
        "unitid": g["UNITID"].astype(int),
        "institution": g["INSTNM_inst"],
        "city": g["CITY"],
        "state": g["STABBR"],
        "control": g["CONTROL_inst"].map({1: "public", 2: "private_nonprofit"}),
        "premium_pct": _pct(g["premium"]).round(1),
        "salary": (g["earnings_display"] * pce).round(-2),
        "salary_horizon": g["earnings_horizon"],
        "salary_adjusted": (g["earnings_display"] * pce / (g["rpp_grad"] / 100)).round(-2),
        "graduates": g["completions"].round().astype(int),
        "earners": g["earners"],
        "overall_rank": g["UNITID"].map(overall_rank),
    })


def export_all(
    overall: pd.DataFrame,
    n_eligible: int,
    majors: pd.DataFrame,
    index: pd.DataFrame,
    sens: pd.DataFrame,
    pce: float,
    generated: str,
) -> None:
    majors_dir = PUBLIC_RANKINGS / "majors"
    if majors_dir.exists():
        shutil.rmtree(majors_dir)
    for stale in ("by_major_top25.json", "majors_index.json"):
        (PUBLIC_RANKINGS / stale).unlink(missing_ok=True)

    rows = school_rows(overall)
    meta = {"generated": generated, "methodology_version": METHODOLOGY_VERSION, "weights": OVERALL_WEIGHTS}
    _write(PUBLIC_RANKINGS / "top250.json", {
        **meta, "n_ranked": int(len(rows)), "n_eligible": n_eligible,
        "schools": _records(rows.head(OVERALL_TOP_N)),
    })
    beats = rows.dropna(subset=["beats_rank"]).sort_values("beats_rank")
    _write(PUBLIC_RANKINGS / "value_added.json", {**meta, "schools": _records(beats.head(OVERALL_TOP_N))})

    overall_rank = rows.set_index("unitid")["rank"]
    top_ids = set(rows.head(OVERALL_TOP_N)["unitid"])
    by_school: dict[str, list] = {}
    for (cred, cip), g in majors.groupby(["credential", "CIPCODE"]):
        g = g.sort_values("rank")
        info = index[(index["credential"] == cred) & (index["CIPCODE"] == cip)].iloc[0]
        _write(majors_dir / f"{cred}-{cip}.json", {
            **meta, "credential": cred, "cip": cip, "name": info["name"], "family": info["family"],
            "national_median": None if pd.isna(info["national_median"]) else round(float(info["national_median"]) * pce, -2),
            "n_ranked": int(info["n_ranked"]),
            "rows": _records(major_rows(g.head(MAJOR_TOP_N), overall_rank, pce)),
        })
        if cred == "bachelors":
            for r in g[g["UNITID"].isin(top_ids)].itertuples():
                by_school.setdefault(str(int(r.UNITID)), []).append([cip, int(r.rank), int(r.n_ranked)])

    idx = index.rename(columns={"CIPCODE": "cip"}).assign(
        national_median=lambda d: (d["national_median"] * pce).round(-2)
    )
    _write(majors_dir / "index.json", {**meta, "majors": _records(idx)})
    bach = index[index["credential"] == "bachelors"]
    _write(majors_dir / "bachelors_by_school.json", {
        **meta, "majors": dict(zip(bach["CIPCODE"], bach["name"])), "ranks": by_school,
    })
    _write(PUBLIC_RANKINGS / "sensitivity.json", _records(sens))
    for name in ("sources.md", "DISCLOSURE.md"):
        shutil.copyfile(OUT / name, PUBLIC_RANKINGS / name)
    print(f"  wrote public rankings → {PUBLIC_RANKINGS}")
