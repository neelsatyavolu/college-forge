"""Protocol tests for the backtest: stable institution split and recoverable noise model."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from backtest import MEDIAN_SE, calibrate_noise, is_test  # noqa: E402


class TestSplit(unittest.TestCase):
    def test_assignment_depends_only_on_the_institution(self):
        groups = pd.Series([f"{i:06d}" for i in range(2000)])
        base = is_test(groups)
        shuffled = groups.sample(frac=1.0, random_state=3)
        self.assertTrue((is_test(shuffled) == base.loc[shuffled.index]).all())
        subset = groups.iloc[::7]
        self.assertTrue((is_test(subset) == base.loc[subset.index]).all())
        self.assertAlmostEqual(base.mean(), 0.20, delta=0.03)


def _synthetic(sigma: float, floor: float, seed: int = 0) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    past, target = [], []
    for g in range(3000):
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


if __name__ == "__main__":
    unittest.main()
