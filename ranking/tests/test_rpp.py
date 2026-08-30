"""Unit tests for purchasing-power COL (methodology v1.2)."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from geo import rpp_young  # noqa: E402
from pseo import rpp_grad_destination, rpp_grad_two_dest  # noqa: E402


class TestRppYoung(unittest.TestCase):
    def test_no_gap_is_unchanged(self):
        self.assertAlmostEqual(float(rpp_young(100, 100)), 100.0)

    def test_extra_housing_weight(self):
        # all-items 110, housing 150, +10pp shelter → 114
        self.assertAlmostEqual(float(rpp_young(110, 150, extra_housing_weight=0.10)), 114.0)

    def test_missing_housing_falls_back_to_all_items(self):
        self.assertAlmostEqual(float(rpp_young(108, np.nan)), 108.0)

    def test_vectorized(self):
        out = rpp_young([100, 110], [100, 150], extra_housing_weight=0.10)
        np.testing.assert_allclose(out, [100.0, 114.0])


class TestDestinationRpp(unittest.TestCase):
    def setUp(self):
        self.rpp_div = {d: 90.0 + d for d in range(1, 10)}  # 91..99
        self.rpp_div[9] = 120.0
        self.rpp_div[2] = 107.0
        self.rpp_div[7] = 93.0

    def _dest(self, div_emp):
        row = {d: 0.0 for d in range(1, 10)}
        row.update(div_emp)
        return pd.DataFrame([row], index=["u"])

    def test_all_stayers_use_campus_local(self):
        dest = self._dest({9: 100})
        out = rpp_grad_destination(
            retention=pd.Series({"u": 1.0}),
            rpp_local=pd.Series({"u": 115.0}),
            home_div=pd.Series({"u": 9}),
            dest_emp=dest,
            rpp_div=self.rpp_div,
            leaver_pool=104.0,
        )
        self.assertAlmostEqual(float(out["u"]), 115.0, places=5)

    def test_all_leavers_use_destination_division(self):
        dest = self._dest({9: 80, 2: 20})
        out = rpp_grad_destination(
            retention=pd.Series({"u": 0.0}),
            rpp_local=pd.Series({"u": 94.0}),
            home_div=pd.Series({"u": 2}),
            dest_emp=dest,
            rpp_div=self.rpp_div,
            leaver_pool=104.0,
        )
        # 80% Pacific 120 + 20% Mid-Atlantic 107 = 117.4
        self.assertAlmostEqual(float(out["u"]), 117.4, places=5)

    def test_stayers_reprice_home_division_to_campus(self):
        # 70% home Pacific (120), 30% elsewhere (93). In-state 60%.
        dest = self._dest({9: 70, 7: 30})
        out = rpp_grad_destination(
            retention=pd.Series({"u": 0.6}),
            rpp_local=pd.Series({"u": 128.0}),
            home_div=pd.Series({"u": 9}),
            dest_emp=dest,
            rpp_div=self.rpp_div,
            leaver_pool=104.0,
        )
        raw = 0.7 * 120 + 0.3 * 93
        expected = raw + 0.6 * (128 - 120)
        self.assertAlmostEqual(float(out["u"]), expected, places=5)

    def test_no_dest_uses_two_bucket_with_leaver_pool_not_100(self):
        dest = self._dest({})  # all zeros
        out = rpp_grad_destination(
            retention=pd.Series({"u": 0.25}),
            rpp_local=pd.Series({"u": 94.0}),
            home_div=pd.Series({"u": 2}),
            dest_emp=dest,
            rpp_div=self.rpp_div,
            leaver_pool=108.0,
        )
        expected = 0.25 * 94 + 0.75 * 108
        self.assertAlmostEqual(float(out["u"]), expected, places=5)
        old = float(rpp_grad_two_dest(pd.Series({"u": 0.25}), pd.Series({"u": 94.0}), 100.0)["u"])
        self.assertGreater(float(out["u"]), old)

    def test_cheap_campus_exporter_is_not_priced_at_campus(self):
        # CMU-like: 23% stay in cheap Mid-Atlantic campus, dest mix leans coastal.
        dest = self._dest({2: 30, 9: 40, 5: 20, 1: 10})
        out = rpp_grad_destination(
            retention=pd.Series({"u": 0.23}),
            rpp_local=pd.Series({"u": 94.0}),
            home_div=pd.Series({"u": 2}),
            dest_emp=dest,
            rpp_div=self.rpp_div,
            leaver_pool=104.0,
        )
        two = float(rpp_grad_two_dest(pd.Series({"u": 0.23}), pd.Series({"u": 94.0}), 100.0)["u"])
        self.assertGreater(float(out["u"]), two)
        self.assertGreater(float(out["u"]), 100.0)


if __name__ == "__main__":
    unittest.main()
