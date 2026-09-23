"""Unit tests for methodology v3 scoring (programs, overall composite, eligibility)."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from institutions import employment_rate  # noqa: E402
from overall import components, composite, coverage  # noqa: E402
from programs import (  # noqa: E402
    collapse_branch_campuses,
    fit_horizon_shift,
    price_prior,
    program_estimates,
    program_premiums,
    school_effects,
)
from util import crossfit_residuals  # noqa: E402

SD = 0.45


def _program(unitid, cip, e4, n4, nat=100_000.0, cred="bachelors", completions=50.0):
    return {
        "UNITID": unitid, "CIPCODE": cip, "credential": cred, "completions": completions,
        "EARN_MDN_1YR": np.nan, "EARN_COUNT_WNE_1YR": np.nan, "nat_1yr": nat,
        "EARN_MDN_4YR": e4, "EARN_COUNT_WNE_4YR": n4, "nat_4yr": nat,
        "EARN_MDN_5YR": np.nan, "EARN_COUNT_WNE_5YR": np.nan, "nat_5yr": nat,
    }


class TestProgramPremiums(unittest.TestCase):
    def test_premium_is_log_ratio_to_same_major(self):
        df = program_premiums(pd.DataFrame([_program(1, "1107", 150_000, 100, nat=100_000)]), SD, shift=None)
        self.assertAlmostEqual(df.loc[0, "y_raw"], np.log(1.5))

    def test_uses_four_year_else_five_year_never_one_year(self):
        both = _program(1, "1107", 120_000, 100)
        both.update({"EARN_MDN_5YR": 150_000, "EARN_COUNT_WNE_5YR": 100, "EARN_MDN_1YR": 90_000, "EARN_COUNT_WNE_1YR": 100})
        five_only = _program(2, "1107", np.nan, np.nan)
        five_only.update({"EARN_MDN_5YR": 150_000, "EARN_COUNT_WNE_5YR": 80})
        one_only = _program(3, "1107", np.nan, np.nan)
        one_only.update({"EARN_MDN_1YR": 90_000, "EARN_COUNT_WNE_1YR": 100})
        df = program_premiums(pd.DataFrame([both, five_only, one_only]), SD, shift=None)
        self.assertAlmostEqual(df.loc[0, "y_raw"], np.log(1.2))
        self.assertEqual(df.loc[0, "earnings_horizon"], "4yr")
        self.assertAlmostEqual(df.loc[1, "y_raw"], np.log(1.5))
        self.assertEqual((df.loc[1, "earnings_horizon"], df.loc[1, "earners"]), ("5yr", 80))
        self.assertTrue(np.isnan(df.loc[2, "y_raw"]))  # 1-year alone is shown, never scored

    def test_sampling_variance_scales_with_sd_squared(self):
        df = pd.DataFrame([_program(1, "1107", 120_000, 100)])
        ratio = program_premiums(df, 0.9, shift=None).loc[0, "se2"] / program_premiums(df, 0.45, shift=None).loc[0, "se2"]
        self.assertAlmostEqual(ratio, 4.0)

    def test_suppressed_cells_stay_missing(self):
        df = program_premiums(pd.DataFrame([_program(1, "1107", np.nan, np.nan)]), SD, shift=None)
        self.assertTrue(np.isnan(df.loc[0, "y_raw"]))


class TestHorizonShift(unittest.TestCase):
    """5-year premiums are mapped onto the 4-year scale with a frozen, fitted per-major shift."""

    def _pairs(self, shift_by_major: dict[str, float], n: int = 60, seed: int = 0) -> pd.DataFrame:
        rng = np.random.default_rng(seed)
        rows = []
        for cip, shift in shift_by_major.items():
            for u in range(n):
                y4 = rng.normal(0, 0.2)
                row = _program(u, cip, 100_000 * np.exp(y4), 200)
                row.update({"EARN_MDN_5YR": 100_000 * np.exp(y4 + shift + rng.normal(0, 0.02)), "EARN_COUNT_WNE_5YR": 200})
                rows.append(row)
        return pd.DataFrame(rows)

    def _fallback(self, cip: str) -> pd.DataFrame:
        row = _program(999, cip, np.nan, np.nan)
        row.update({"EARN_MDN_5YR": 150_000, "EARN_COUNT_WNE_5YR": 20})
        return pd.DataFrame([row])

    def test_fallback_program_is_moved_onto_the_four_year_scale(self):
        shift = fit_horizon_shift(self._pairs({"5009": 0.15, "1107": 0.0}), "major")
        out = program_premiums(self._fallback("5009"), SD, shift=shift).iloc[0]
        self.assertAlmostEqual(out["y_raw"], np.log(1.5) - 0.15, delta=0.02)
        self.assertAlmostEqual(out["horizon_shift"], 0.15, delta=0.02)
        uncorrected = program_premiums(self._fallback("5009"), SD, shift=None).iloc[0]
        self.assertGreater(out["se2"], uncorrected["se2"])  # mapping uncertainty is carried

    def test_four_year_programs_are_untouched(self):
        pairs = self._pairs({"5009": 0.15})
        shift = fit_horizon_shift(pairs, "major")
        out = program_premiums(pairs, SD, shift=shift)
        np.testing.assert_allclose(out["y_raw"], np.log(pairs["EARN_MDN_4YR"] / pairs["nat_4yr"]))
        self.assertTrue((out["horizon_shift"] == 0).all())

    def test_unmatched_major_uses_credential_mean_and_between_major_variance(self):
        shift = fit_horizon_shift(self._pairs({"5009": 0.15, "1107": -0.05, "4201": 0.05}), "major")
        mean, between = shift.by_credential["bachelors"]
        delta, var = shift.lookup(pd.Series(["bachelors"]), pd.Series(["9999"]))
        self.assertAlmostEqual(delta.iloc[0], mean)
        self.assertAlmostEqual(var.iloc[0], between)
        self.assertGreater(between, 0.0)

    def test_none_level_applies_no_correction(self):
        shift = fit_horizon_shift(self._pairs({"5009": 0.15}), "none")
        out = program_premiums(self._fallback("5009"), SD, shift=shift).iloc[0]
        self.assertAlmostEqual(out["y_raw"], np.log(1.5))


class TestHierarchicalModel(unittest.TestCase):
    FLAT = pd.Series(0.0, index=range(60))

    def _panel(self, small_program_value: float = 0.0):
        rng = np.random.default_rng(0)
        rows = []
        for school in range(60):
            effect = 0.6 if school == 0 else rng.normal(0, 0.2)
            for major in range(8):
                small = school == 0 and major == 0
                y = small_program_value if small else effect + rng.normal(0, 0.05)
                rows.append(_program(school, f"{1000 + major}", 100_000 * np.exp(y), 25 if small else 200))
        return program_premiums(pd.DataFrame(rows), SD, shift=None)

    def _fit(self, progs):
        prior = price_prior(progs, self.FLAT)
        schools, diag = school_effects(progs, self.FLAT, prior)
        return schools, program_estimates(progs, schools, diag)

    def test_school_effect_pools_programs_and_stays_strong(self):
        schools, _ = self._fit(self._panel())
        s = schools.set_index("UNITID")
        self.assertTrue((s["mu_sd"] > 0).all())
        self.assertGreater(s.loc[0, "mu_hat"], 0.4)

    def test_noisy_program_borrows_from_its_school(self):
        # School 0 is strong; its small program reports the national median. The estimate is
        # pulled toward the school's effect (what next-cohort prediction favored in the backtest).
        _, progs = self._fit(self._panel(small_program_value=0.0))
        small = progs[(progs["UNITID"] == 0) & (progs["CIPCODE"] == "1000")].iloc[0]
        self.assertGreater(small["y_program"], 0.0)
        self.assertLess(small["y_program"], small["mu_hat"])

    def test_floor_is_added_exactly_once(self):
        progs = self._panel()
        prior = price_prior(progs, self.FLAT)
        schools, diag = school_effects(progs, self.FLAT, prior)
        none = program_estimates(progs, schools, diag, floor_sd={"bachelors": 0.0})
        some = program_estimates(progs, schools, diag, floor_sd={"bachelors": 0.05})
        np.testing.assert_allclose(some["y_program_sd"] ** 2 - none["y_program_sd"] ** 2, 0.05 ** 2)

    def test_large_program_keeps_mostly_its_own_result(self):
        _, progs = self._fit(self._panel())
        big = progs[(progs["UNITID"] == 3) & (progs["CIPCODE"] == "1001")].iloc[0]
        self.assertLess(abs(big["y_program"] - big["y_raw"]), abs(big["mu_hat"] - big["y_raw"]))


class TestPricePrior(unittest.TestCase):
    def test_prior_recovers_intercept_and_slope(self):
        rng = np.random.default_rng(1)
        price = pd.Series(rng.normal(0, 0.1, 300), index=range(300))
        rows = [_program(u, "1107", 100_000 * np.exp(0.05 + 0.6 * price[u]), 400) for u in price.index]
        alpha, beta = price_prior(program_premiums(pd.DataFrame(rows), SD, shift=None), price)["bachelors"]
        self.assertAlmostEqual(alpha, 0.05, places=2)
        self.assertAlmostEqual(beta, 0.6, places=2)

    def test_data_poor_school_lands_on_price_prior(self):
        price = pd.Series({u: 0.2 if u == 0 else 0.0 for u in range(40)})
        rows = [_program(u, "1107", 100_000 * np.exp(0.05 * (u % 3)), 400) for u in range(1, 40)]
        rows.append(_program(0, "1107", 100_000, 10))
        progs = program_premiums(pd.DataFrame(rows), SD, shift=None)
        progs.loc[progs["UNITID"] == 0, "se2"] = 1e6  # effectively no information
        prior = {"bachelors": (0.01, 0.5)}
        schools, _ = school_effects(progs, price, prior)
        mu = schools.set_index("UNITID").loc[0]
        self.assertAlmostEqual(mu["mu_hat"], 0.01 + 0.5 * 0.2, places=3)
        self.assertAlmostEqual(mu["mu_price_loading"], 0.5, places=3)


class TestCostOfLivingWeight(unittest.TestCase):
    def _components(self, weight: float) -> pd.DataFrame:
        schools = pd.DataFrame({"UNITID": [1, 2], "MD_EARN_WNE_P10": [60_000.0, 60_000.0],
                                "C150_4": [0.8, 0.7], "employment_rate": [0.9, 0.9]})
        effects = pd.DataFrame({"UNITID": [1, 2], "credential": "bachelors", "mu_hat": [0.10, 0.10],
                                "mu_sd": [0.02, 0.02], "mu_price_loading": [0.30, 0.30]})
        rpp = pd.DataFrame({"rpp_grad": [120.0, 90.0], "rpp_log_sd": [0.016, 0.0]}, index=[1, 2])
        expected = pd.Series(55_000.0, index=[1, 2])
        return components(schools, effects, expected, rpp, price_weight=weight)

    def test_half_weight_is_the_midpoint_in_log_earnings(self):
        none, half, full = (self._components(w) for w in (0.0, 0.5, 1.0))
        np.testing.assert_allclose(half["early_premium"], (none["early_premium"] + full["early_premium"]) / 2)
        self.assertAlmostEqual(half.loc[1, "early_premium"], 0.10 - 0.5 * np.log(1.2))

    def test_price_error_moves_the_estimate_by_loading_minus_weight(self):
        for w in (0.0, 0.5, 1.0):
            self.assertAlmostEqual(self._components(w).loc[1, "price_coef"], 0.30 - w)


class TestCrossFit(unittest.TestCase):
    def test_prediction_never_uses_the_schools_own_outcome(self):
        rng = np.random.default_rng(2)
        X = pd.DataFrame({"a": rng.normal(size=200), "b": rng.normal(size=200)})
        y = X["a"] * 2 + rng.normal(size=200)
        before = y - crossfit_residuals(y, X)
        y2 = y.copy()
        y2.iloc[7] += 1000
        after = y2 - crossfit_residuals(y2, X)
        self.assertAlmostEqual(before.iloc[7], after.iloc[7], places=9)


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
