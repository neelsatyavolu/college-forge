"""Protocol tests for the backtest: stable institution split and recoverable noise model."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from backtest import MEDIAN_SE, calibrate_noise, horizon_test, is_test, protocol, select  # noqa: E402


class TestSplit(unittest.TestCase):
    def test_assignment_depends_only_on_the_institution(self):
        groups = pd.Series([f"{i:06d}" for i in range(2000)])
        base = is_test(groups)
        shuffled = groups.sample(frac=1.0, random_state=3)
        self.assertTrue((is_test(shuffled) == base.loc[shuffled.index]).all())
        subset = groups.iloc[::7]
        self.assertTrue((is_test(subset) == base.loc[subset.index]).all())
        self.assertAlmostEqual(base.mean(), 0.20, delta=0.03)


def _synthetic(sigma: float, floor: float, seed: int = 0, n: int = 3000) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    past, target = [], []
    for g in range(n):
        cip = f"{1000 + g % 10}"
        truth = rng.normal(0, 0.2)
        n_p, n_t = rng.integers(20, 400, 2)
        y_p = truth + rng.normal(0, MEDIAN_SE * sigma / np.sqrt(n_p))
        y_t = truth + rng.normal(0, floor) + rng.normal(0, MEDIAN_SE * sigma / np.sqrt(n_t))
        key = {"group": f"{g:06d}", "CIPCODE": cip, "CREDLEV": 3}
        past.append({**key, "UNITID": g, "credential": "bachelors",
                     "EARN_MDN_4YR": 50_000 * np.exp(y_p), "EARN_COUNT_WNE_4YR": n_p, "nat_4yr": 50_000,
                     "EARN_MDN_5YR": np.nan, "EARN_COUNT_WNE_5YR": np.nan, "nat_5yr": 50_000,
                     "EARN_MDN_1YR": np.nan, "EARN_COUNT_WNE_1YR": np.nan, "nat_1yr": np.nan})
        target.append({**key, "y_target": y_t, "n_target": n_t})
    return pd.DataFrame(past), pd.DataFrame(target)


class TestNoiseCalibration(unittest.TestCase):
    def test_recovers_known_sigma_and_floor(self):
        past, target = _synthetic(sigma=0.45, floor=0.05)
        cal = calibrate_noise(past, target)["bachelors"]
        self.assertAlmostEqual(cal["sigma"], 0.45, delta=0.03)
        self.assertAlmostEqual(cal["floor_sd"], 0.05, delta=0.02)

    def test_major_level_shift_does_not_inflate_sigma(self):
        # A per-major offset between releases (e.g. a different national-median construction)
        # must be removed before fitting, not absorbed into the noise scale.
        past, target = _synthetic(sigma=0.45, floor=0.0, seed=1)
        shifted = target.assign(y_target=target["y_target"] + target["CIPCODE"].astype(int).mod(10) * 0.05)
        cal = calibrate_noise(past, shifted)["bachelors"]
        self.assertAlmostEqual(cal["sigma"], 0.45, delta=0.03)


class TestHoldoutIndependence(unittest.TestCase):
    """Held-out (test-institution) outcomes must not change anything fitted or selected."""

    def _scramble_test_targets(self, target: pd.DataFrame) -> pd.DataFrame:
        test = is_test(target["group"])
        rng = np.random.default_rng(9)
        return target.assign(y_target=target["y_target"].where(~test, rng.normal(0, 1, len(target))))

    def test_selection_and_calibration_ignore_test_targets(self):
        past, target = _synthetic(sigma=0.45, floor=0.03, seed=4, n=800)
        a = select(past, target, "none")
        b = select(past, self._scramble_test_targets(target), "none")
        self.assertEqual(a["chosen"], b["chosen"])
        self.assertEqual(a["tuned_major_only"], b["tuned_major_only"])
        self.assertEqual(a["noise"], b["noise"])

    def test_horizon_level_is_chosen_on_development_institutions_only(self):
        rng = np.random.default_rng(5)
        rows = []
        for g in range(1200):
            cip = f"{1000 + g % 12}"
            y4 = rng.normal(0, 0.2)
            rows.append({"group": f"{g:06d}", "UNITID": g, "CIPCODE": cip, "credential": "bachelors",
                         "EARN_MDN_4YR": 50_000 * np.exp(y4), "EARN_COUNT_WNE_4YR": 100, "nat_4yr": 50_000,
                         "EARN_MDN_5YR": 50_000 * np.exp(y4 + 0.02 * (g % 12) + rng.normal(0, 0.05)),
                         "EARN_COUNT_WNE_5YR": 100, "nat_5yr": 50_000})
        cur = pd.DataFrame(rows)
        noise = {"bachelors": {"sigma": 0.45, "floor_sd": 0.02}}
        a = horizon_test(cur, noise)
        test = is_test(cur["group"])
        scrambled = cur.assign(EARN_MDN_4YR=cur["EARN_MDN_4YR"].where(~test, 50_000 * np.exp(rng.normal(0, 1, len(cur)))))
        b = horizon_test(scrambled, noise)
        self.assertEqual(a["dev_cross_fit_rmse"], b["dev_cross_fit_rmse"])
        self.assertEqual(a["selected_on_dev"], b["selected_on_dev"])
        self.assertEqual(a["selected_on_dev"], "major")

    def test_full_protocol_ignores_test_outcomes(self):
        # End to end: current-release outcomes of test institutions (the backtest target AND
        # the horizon check's 4-year figures) must not change anything the backtest fits or selects.
        past, _ = _synthetic(sigma=0.45, floor=0.03, seed=6, n=800)
        rng = np.random.default_rng(6)
        y4 = rng.normal(0, 0.2, len(past))
        cur = past[["group", "UNITID", "CIPCODE", "CREDLEV", "credential"]].assign(
            EARN_MDN_4YR=50_000 * np.exp(y4), EARN_COUNT_WNE_4YR=100, EARN_MDN_4YR_NAT=50_000, nat_4yr=50_000,
            EARN_MDN_5YR=50_000 * np.exp(y4 + rng.normal(0, 0.05, len(past))), EARN_COUNT_WNE_5YR=100, nat_5yr=50_000)
        test = is_test(cur["group"])
        scrambled = cur.assign(EARN_MDN_4YR=cur["EARN_MDN_4YR"].where(~test, 50_000 * np.exp(rng.normal(0, 1, len(cur)))))
        _, h_a, a = protocol(past, cur)
        _, h_b, b = protocol(past, scrambled)
        self.assertEqual(h_a["selected_on_dev"], h_b["selected_on_dev"])
        self.assertEqual(a["chosen"], b["chosen"])
        self.assertEqual(a["tuned_major_only"], b["tuned_major_only"])
        self.assertEqual(a["noise"], b["noise"])
        self.assertEqual(a["shift"].level, h_a["selected_on_dev"])


if __name__ == "__main__":
    unittest.main()
