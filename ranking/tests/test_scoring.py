"""Unit tests for methodology v2 scoring (programs, overall composite, eligibility)."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from institutions import employment_rate  # noqa: E402
from overall import composite, coverage  # noqa: E402
from programs import collapse_branch_campuses, major_estimates, program_premiums, school_effects  # noqa: E402


def _program(unitid, cip, e4, n4, nat=100_000.0, cred="bachelors", completions=50.0):
    return {
        "UNITID": unitid, "CIPCODE": cip, "credential": cred, "completions": completions,
        "EARN_MDN_1YR": np.nan, "EARN_COUNT_WNE_1YR": np.nan, "nat_1yr": nat,
        "EARN_MDN_4YR": e4, "EARN_COUNT_WNE_4YR": n4, "nat_4yr": nat,
        "EARN_MDN_5YR": np.nan, "EARN_COUNT_WNE_5YR": np.nan, "nat_5yr": nat,
    }


class TestProgramPremiums(unittest.TestCase):
    def test_premium_is_log_ratio_to_same_major(self):
        df = program_premiums(pd.DataFrame([_program(1, "1107", 150_000, 100, nat=100_000)]))
        self.assertAlmostEqual(df.loc[0, "y_raw"], np.log(1.5))

    def test_horizons_pool_by_precision(self):
        row = _program(1, "1107", 120_000, 100)
        row.update({"EARN_MDN_5YR": 150_000, "EARN_COUNT_WNE_5YR": 100})
        y = program_premiums(pd.DataFrame([row])).loc[0, "y_raw"]
        self.assertAlmostEqual(y, (np.log(1.2) + np.log(1.5)) / 2)

    def test_suppressed_cells_stay_missing(self):
        df = program_premiums(pd.DataFrame([_program(1, "1107", np.nan, np.nan)]))
        self.assertTrue(np.isnan(df.loc[0, "y_raw"]))


class TestShrinkage(unittest.TestCase):
    def _panel(self, strong_school_small_program: float = 0.0):
        rng = np.random.default_rng(0)
        rows = []
        for school in range(60):
            effect = 0.6 if school == 0 else rng.normal(0, 0.2)
            for major in range(8):
                small = school == 0 and major == 0
                y = strong_school_small_program if small else effect + rng.normal(0, 0.05)
                rows.append(_program(school, f"{1000 + major}", 100_000 * np.exp(y), 25 if small else 200))
        return program_premiums(pd.DataFrame(rows))

    def test_school_effect_pools_programs_and_shrinks_with_less_data(self):
        schools, _ = school_effects(self._panel())
        s = schools.set_index("UNITID")
        self.assertTrue((s["mu_sd"] > 0).all())
        self.assertTrue(np.all(np.abs(s["mu_hat"]) <= np.abs(s["m"]) + 1e-12))
        self.assertGreater(s.loc[0, "mu_hat"], 0.4)  # a strong school stays strong

    def test_program_never_inherits_its_schools_strength(self):
        # School 0 is excellent overall, but its small major-1000 program is exactly national median.
        progs = major_estimates(self._panel(strong_school_small_program=0.0))
        small = progs[(progs["UNITID"] == 0) & (progs["CIPCODE"] == "1000")].iloc[0]
        self.assertAlmostEqual(small["y_major"], 0.0, places=6)

    def test_noisy_programs_shrink_more_toward_national_median(self):
        progs = major_estimates(self._panel(strong_school_small_program=0.6))
        major = progs[progs["CIPCODE"] == "1000"]
        small = major[major["UNITID"] == 0].iloc[0]
        big = major[major["UNITID"] != 0].iloc[0]
        self.assertLess(small["y_major"] / small["y_raw"], big["y_major"] / big["y_raw"])
        self.assertGreater(small["y_major"], 0.0)


class TestBranchCampuses(unittest.TestCase):
    def test_collapses_shared_opeid_cells_to_main_campus(self):
        df = pd.DataFrame([
            {"UNITID": 1, "OPEID6": 100, "MAIN": 1, "CIPCODE": "1107", "CREDLEV": 3, "completions": 50.0},
            {"UNITID": 2, "OPEID6": 100, "MAIN": 0, "CIPCODE": "1107", "CREDLEV": 3, "completions": 80.0},
            {"UNITID": 3, "OPEID6": np.nan, "MAIN": 1, "CIPCODE": "1107", "CREDLEV": 3, "completions": 10.0},
            {"UNITID": 4, "OPEID6": np.nan, "MAIN": 1, "CIPCODE": "1107", "CREDLEV": 3, "completions": 20.0},
        ])
        out = collapse_branch_campuses(df).set_index("UNITID")
        self.assertEqual(sorted(out.index), [1, 3, 4])  # missing OPEID6 never merges schools
        self.assertEqual(out.loc[1, "completions"], 130.0)


class TestComposite(unittest.TestCase):
    def _comp(self):
        return pd.DataFrame({
            "early_premium": [0.3, 0.1, -0.1, np.nan],
            "long_premium": [0.2, 0.0, -0.2, 0.1],
            "graduation": [0.9, np.nan, 0.6, 0.8],
            "employment": [0.95, 0.9, 0.85, 0.9],
        }, index=[1, 2, 3, 4])

    def test_requires_early_earnings_and_graduation(self):
        s = composite(self._comp())
        self.assertTrue(np.isnan(s.loc[4]))  # no early-career earnings
        self.assertTrue(np.isnan(s.loc[2]))  # no graduation rate

    def test_optional_component_renormalizes_instead_of_imputing(self):
        comp = self._comp()
        comp.loc[3, "employment"] = np.nan
        full = composite(comp)
        self.assertFalse(np.isnan(full.loc[3]))
        # School 3 lacks employment: its score must not depend on others' employment values
        comp2 = comp.copy()
        comp2.loc[1, "employment"] = 0.5
        z_shift = composite(comp2).loc[3] - full.loc[3]
        self.assertAlmostEqual(z_shift, 0.0, places=6)

    def test_better_outcomes_score_higher(self):
        s = composite(self._comp())
        self.assertGreater(s.loc[1], s.loc[3])


class TestEligibilityHelpers(unittest.TestCase):
    def test_employment_rate_uses_graduates_three_years_out(self):
        inst = pd.DataFrame({"COUNT_WNE_3YR": [90, 0], "COUNT_NWNE_3YR": [10, 0]})
        r = employment_rate(inst)
        self.assertAlmostEqual(r.iloc[0], 0.9)
        self.assertTrue(np.isnan(r.iloc[1]))

    def test_coverage_counts_only_published_programs(self):
        progs = pd.DataFrame({
            "UNITID": [1, 1], "credential": ["bachelors"] * 2,
            "completions": [30.0, 70.0], "y_raw": [0.1, np.nan],
        })
        self.assertAlmostEqual(coverage(progs).loc[1], 0.3)


if __name__ == "__main__":
    unittest.main()
