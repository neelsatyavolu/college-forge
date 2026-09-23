"""Source-to-export checks: published numbers must match official Scorecard records.

These run against the raw download and the exported JSON, so they catch unit and
dollar-year mistakes that formula-level unit tests cannot. Skipped when either is absent.
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from config import FIELD_DOLLAR_YEAR, FOS_CSV, PUBLIC_RANKINGS, REFERENCE_YEAR  # noqa: E402
from dollars import factor  # noqa: E402

MAJORS = PUBLIC_RANKINGS / "majors"
# (unitid, cip, CREDLEV, published file) — both modeled horizons, both credentials, a branch group
SPOT_CHECKS = [
    (211440, "1107", 3, "bachelors"),  # Carnegie Mellon, computer science (4-yr)
    (178396, "0904", 3, "bachelors"),  # Missouri-Columbia, journalism (4-yr)
    (152080, "4201", 3, "bachelors"),  # Notre Dame, psychology (4-yr)
    (104151, "5202", 3, "bachelors"),  # Arizona State, business (branch campuses collapsed)
    (163286, "0100", 3, "bachelors"),  # Maryland, agriculture (5-yr fallback)
    (243744, "1107", 5, "masters"),    # Stanford, MS computer science (4-yr)
    (215062, "5202", 5, "masters"),    # Penn, MBA (4-yr)
]
HORIZON_FIELD = {"1yr": "EARN_MDN_1YR", "4yr": "EARN_MDN_4YR", "5yr": "EARN_MDN_5YR"}
COUNT_FIELD = {"1yr": "EARN_COUNT_WNE_1YR", "4yr": "EARN_COUNT_WNE_4YR", "5yr": "EARN_COUNT_WNE_5YR"}


@unittest.skipUnless(FOS_CSV.exists() and (MAJORS / "index.json").exists(), "raw data or exports absent")
class TestPublishedEarningsMatchSource(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cols = ["UNITID", "CIPCODE", "CREDLEV", "EARN_MDN_4YR_NAT",
                *HORIZON_FIELD.values(), *COUNT_FIELD.values()]
        fos = pd.read_csv(FOS_CSV, usecols=cols, low_memory=False)
        fos["CIPCODE"] = fos["CIPCODE"].astype(str).str.replace(r"\.0$", "", regex=True).str.zfill(4)
        for c in cols[3:]:
            fos[c] = pd.to_numeric(fos[c], errors="coerce")
        cls.fos = fos

    def _official(self, unitid, cip, credlev):
        rows = self.fos[(self.fos["UNITID"] == unitid) & (self.fos["CIPCODE"] == cip) & (self.fos["CREDLEV"] == credlev)]
        return rows.dropna(subset=["EARN_MDN_4YR", "EARN_MDN_5YR", "EARN_MDN_1YR"], how="all").iloc[0]

    def _published(self, unitid, cip, cred):
        rows = json.loads((MAJORS / f"{cred}-{cip}.json").read_text())["rows"]
        return next(r for r in rows if r["unitid"] == unitid)

    def test_every_spot_check_matches_the_official_record(self):
        seen = set()
        for unitid, cip, credlev, cred in SPOT_CHECKS:
            src, pub = self._official(unitid, cip, credlev), self._published(unitid, cip, cred)
            h = pub["earnings_horizon"]
            field = HORIZON_FIELD[h]
            with self.subTest(unitid=unitid, cip=cip, horizon=h):
                self.assertEqual(pub["earnings"], round(float(src[field]) * factor(field), -2))
                self.assertEqual(pub["earnings_count"], float(src[COUNT_FIELD[h]]))
            seen.add((h, cred))
        # Guard against vacuous passes: each modeled horizon and both credentials are exercised.
        self.assertEqual({h for h, _ in seen}, {"4yr", "5yr"})
        self.assertEqual({c for _, c in seen}, {"bachelors", "masters"})

    def test_one_year_only_programs_are_not_ranked(self):
        # Auburn agriculture publishes only 1-year earnings (partly pandemic years, overlapping
        # the next class), which the validated model does not use.
        rows = json.loads((MAJORS / "bachelors-0100.json").read_text())["rows"]
        self.assertNotIn(100858, {r["unitid"] for r in rows})
        self.assertTrue(all(r["earnings_horizon"] in {"4yr", "5yr"} for r in rows))

    def test_four_year_earnings_are_published_unchanged(self):
        # EARN_MDN_4YR is already in REFERENCE_YEAR dollars; export must only round to $100.
        self.assertEqual(FIELD_DOLLAR_YEAR["EARN_MDN_4YR"], REFERENCE_YEAR)
        self.assertEqual(factor("EARN_MDN_4YR"), 1.0)

    def test_national_median_is_not_reinflated(self):
        pub = json.loads((MAJORS / "bachelors-1107.json").read_text())
        nat = self.fos[(self.fos["CIPCODE"] == "1107") & (self.fos["CREDLEV"] == 3)]["EARN_MDN_4YR_NAT"].dropna()
        self.assertEqual(pub["national_median"], round(float(nat.median()), -2))


class TestDollarFactors(unittest.TestCase):
    def test_reference_year_fields_are_not_adjusted(self):
        for field, year in FIELD_DOLLAR_YEAR.items():
            if year == REFERENCE_YEAR:
                self.assertEqual(factor(field), 1.0)

    def test_older_fields_are_inflated_forward(self):
        for field, year in FIELD_DOLLAR_YEAR.items():
            if year < REFERENCE_YEAR:
                self.assertGreater(factor(field), 1.0)


if __name__ == "__main__":
    unittest.main()
