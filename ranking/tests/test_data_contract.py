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
# (unitid, cip, credential file) — spot checks spanning majors, sizes and credentials
SPOT_CHECKS = [
    (211440, "1107", "bachelors"),  # Carnegie Mellon, computer science
    (190415, "1107", "bachelors"),  # Cornell, computer science
    (178396, "0904", "bachelors"),  # Missouri-Columbia, journalism
    (152080, "4201", "bachelors"),  # Notre Dame, psychology
]


@unittest.skipUnless(FOS_CSV.exists() and (MAJORS / "index.json").exists(), "raw data or exports absent")
class TestPublishedEarningsMatchSource(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cols = ["UNITID", "CIPCODE", "CREDLEV", "EARN_MDN_1YR", "EARN_MDN_4YR", "EARN_MDN_5YR",
                "EARN_COUNT_WNE_4YR", "EARN_MDN_4YR_NAT"]
        fos = pd.read_csv(FOS_CSV, usecols=cols, low_memory=False)
        fos["CIPCODE"] = fos["CIPCODE"].astype(str).str.replace(r"\.0$", "", regex=True).str.zfill(4)
        cls.fos = fos

    def _official(self, unitid, cip, credlev=3):
        return self.fos[(self.fos["UNITID"] == unitid) & (self.fos["CIPCODE"] == cip) & (self.fos["CREDLEV"] == credlev)].iloc[0]

    def _published(self, unitid, cip, cred):
        rows = json.loads((MAJORS / f"{cred}-{cip}.json").read_text())["rows"]
        return next(r for r in rows if r["unitid"] == unitid)

    def test_four_year_earnings_are_published_unchanged(self):
        # EARN_MDN_4YR is already in REFERENCE_YEAR dollars; export must only round to $100.
        self.assertEqual(FIELD_DOLLAR_YEAR["EARN_MDN_4YR"], REFERENCE_YEAR)
        for unitid, cip, cred in SPOT_CHECKS:
            src, pub = self._official(unitid, cip), self._published(unitid, cip, cred)
            if pub["earnings_horizon"] != "4yr":
                continue
            with self.subTest(unitid=unitid, cip=cip):
                self.assertEqual(pub["earnings"], round(float(src["EARN_MDN_4YR"]), -2))
                self.assertEqual(pub["earnings_count"], float(src["EARN_COUNT_WNE_4YR"]))

    def test_other_horizons_are_restated_from_their_own_dollar_year(self):
        for unitid, cip, cred in SPOT_CHECKS:
            src, pub = self._official(unitid, cip), self._published(unitid, cip, cred)
            h = pub["earnings_horizon"]
            if h == "4yr":
                continue
            field = {"1yr": "EARN_MDN_1YR", "5yr": "EARN_MDN_5YR"}[h]
            with self.subTest(unitid=unitid, cip=cip, horizon=h):
                self.assertEqual(pub["earnings"], round(float(src[field]) * factor(field), -2))

    def test_national_median_is_not_reinflated(self):
        pub = json.loads((MAJORS / "bachelors-1107.json").read_text())
        nat = self.fos[(self.fos["CIPCODE"] == "1107") & (self.fos["CREDLEV"] == 3)]["EARN_MDN_4YR_NAT"]
        nat = pd.to_numeric(nat, errors="coerce").dropna()
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
