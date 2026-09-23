"""Regression checks: model settings pinned in config match the backtest's output.

These guard against config drifting from the evidence. They do not by themselves prove
calibration; that evidence is the protocol in src/backtest.py (see test_backtest.py).
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from config import LOG_EARNINGS_SD, OUT, PROGRAM_FLOOR_SD, SHRINK_K  # noqa: E402

BACKTEST = OUT / "backtest.json"


@unittest.skipUnless(BACKTEST.exists(), "run src/backtest.py first")
class TestPinsMatchBacktest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bt = json.loads(BACKTEST.read_text())

    def test_noise_pins_match_calibration(self):
        for cred in LOG_EARNINGS_SD:
            cal = self.bt["noise_calibration"][cred]
            with self.subTest(credential=cred):
                self.assertAlmostEqual(LOG_EARNINGS_SD[cred], cal["sigma"], delta=0.005)
                self.assertAlmostEqual(PROGRAM_FLOOR_SD[cred], cal["floor_sd"], delta=0.005)

    def test_shrinkage_and_estimator_match_selection(self):
        for cred, k in SHRINK_K.items():
            chosen = self.bt["chosen"][cred]
            with self.subTest(credential=cred):
                self.assertEqual(k, chosen["k"])
                self.assertEqual(chosen["estimator"], "hierarchical")

    def test_selected_model_beats_baselines_on_held_out_institutions(self):
        for cred, chosen in self.bt["chosen"].items():
            with self.subTest(credential=cred):
                err = chosen["test"]["within_major_rmse"]
                self.assertLess(err, chosen["test_raw_baseline"]["within_major_rmse"])
                self.assertLess(err, chosen["test_major_only_sd070"]["within_major_rmse"])


if __name__ == "__main__":
    unittest.main()
