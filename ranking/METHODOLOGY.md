# Forge career-outcomes ranking — methodology v3.0

## What this is, and what it is not

A **comparison of past graduates' outcomes**, from federal administrative data on students who received federal aid. The program earnings estimates behind it were **backtested in a corrected retrospective evaluation**: built only from earlier graduating classes, they predicted the next classes' earnings better than the alternatives tested on institutions excluded from the final calibration and selection, and separate 90% next-class prediction intervals held the next classes' results 91–94% of the time (§10). The narrower intervals behind published rank ranges are not validated to that level (§9).

- It **describes** where covered former students had strong earnings, completion and employment.
- The composite weights and the rank ranges are **not** validated by that backtest (§9, §10).
- It does **not estimate what a college causes**, including in "Beats expectations", and it is not a forecast for any individual student.

## 1. Principles

1. **Outcomes, not inputs.** Admit rate, test scores, yield, research, spending and reputation get no direct weight. (Admissions variables appear only in the graduate-destination model for the cost-of-living view, §4, and in the separate expectations view, §8.)
2. **Compare like with like.** Graduates are compared with graduates of the same major and credential nationally.
3. **Fewest unvalidated assumptions in the headline.** The headline ranks earnings as reported and uses **no geography at all**. The cost-of-living ordering is published alongside; it depends on where graduates work, which is modeled for about three-quarters of schools and not externally validated (§4).
4. **Model choices are made by prediction, not by how the list looks.** Where the data can decide (error scale, how much to shrink, whether to pool with the school), the choice was made by next-class prediction on development institutions (§10). Component weights are value judgments fixed before results were inspected.
5. **Nothing is imputed.** Suppressed programs are not ranked; unknown completion counts stay unknown.

## 2. Universes

| Table | Included |
|---|---|
| Overall (1,281 schools) | Public or private nonprofit, in the 50 states or DC, operating, main campus, predominantly bachelor's, ≥500 undergraduates, not online-only; ≥30% of known bachelor's completions in programs with a modeled earnings estimate; a first-time-student graduation rate |
| Per major (156 bachelor's, 85 master's) | Any operating public or private nonprofit school in the 50 states or DC, not online-only; majors (4-digit CIP) with ≥20 ranked schools; the top 250 under either ordering are published |

Territories are excluded (no BEA price parities). Programs are identified by OPEID6 × CIP × credential; branch campuses repeating a parent's cells are collapsed into one program credited to the main campus.

## 3. Data, cohorts and dollars

| Field | Who, when (June 10, 2026 release) | Source dollars | Use |
|---|---|---|---|
| `EARN_MDN_4YR`, `EARN_MDN_4YR_NAT` | 2017–19 graduates, earnings in 2022–23 | 2024 | Scored |
| `EARN_MDN_5YR` | 2014–16 graduates, earnings in 2020–21 | 2022 | Scored where 4-year is suppressed (~9% of estimates) |
| `EARN_MDN_1YR` | 2018–20 graduates, earnings in 2020–21 | 2022 | Not scored |
| `MD_EARN_WNE_P10` | students who entered 2009–11, earnings in 2020–21 | 2022 | Shown, not scored |
| `COUNT_WNE_3YR`, `COUNT_NWNE_3YR` | 2014–16 graduates, working status in 2018–19 | — | Employment (scored) |
| `C150_4` | first-time full-time students starting around fall 2018 | — | Graduation (scored) |

Dollar years come from the data dictionary's cohort maps (`config.FIELD_DOLLAR_YEAR`); every field is restated in **2024 dollars** at load. `tests/test_data_contract.py` checks published figures against the official file for both modeled horizons, both credentials and a branch-campus group. "Earnings" are annual W-2 wages plus positive self-employment earnings for federal aid recipients working and not enrolled — not base salaries, and not international students.

## 4. Cost of living (alternative ordering only)

BEA Regional Price Parities with 10 extra percentage points of housing weight (a young-renter basket). In-state graduates are priced at the campus labor market (counties within 40 miles); leavers at Census-division destinations from PSEO. **Destinations are observed for 460 of 1,740 schools and modeled for the rest** (held-out log error ≈ 0.016). That model reconstructs a target built from coarse destinations and campus-local prices, so its fit is not external validation, and in-state is not the same as near campus. State taxes are not deducted. For these reasons geography is used only in the alternative ordering.

## 5. Program estimates

**Observation.** For each program (school × 4-digit CIP × credential):

```
y = ln(program median / national median for the same major and credential)
```

using **4-year earnings, else 5-year**. Only one horizon is used per program: the 4- and 5-year figures describe overlapping or different classes and are not independent measurements. 1-year earnings (partly pandemic years, overlapping the next class) are not scored. This is exactly the observation model the backtest evaluates.

The 4-year baseline is Scorecard's official national median (`EARN_MDN_4YR_NAT`). Scorecard publishes no 5-year national median, so the 5-year baseline is an earner-weighted median of program medians across all institutions. That is a different statistic, used for the ~9% of estimates that fall back to 5-year earnings.

**Error scale (calibrated).** The sampling variance of a median is taken as `(1.2533 · σ)² / n`. σ is an **effective, count-dependent error scale**, fitted on development institutions from how much the same programs moved between classes with no overlapping completion years. Each major's systematic shift is removed first, and the fit is non-negative. **σ = 0.454 for bachelor's, 0.382 for master's**; v2 assumed 0.70. The same fit gives a **count-independent floor** (SD 0.020 bachelor's, 0.048 master's): change between classes that does not shrink with program size.

**Two-level model (selected by backtest).** Program premium = school effect + program deviation + noise.

- **School effect** (overall ranking): a school's programs are pooled, then shrunk toward a prior in proportion to how little data the school has. The prior is the typical premium α (≈ 0) for the headline. For the cost-of-living view it is `α + β·ln(RPP/100)` (β ≈ 0.82 bachelor's, 0.99 master's: nominal pay rises with local prices).
- **Program estimate** (per-major rankings): the program's own premium, shrunk toward its school's effect by `b = ω² / (ω² + k·se²)`, with **k = 1.5 bachelor's, 2 master's** chosen by next-class prediction.

**A program therefore borrows from its own school's results in other majors**, in proportion to how noisy its own data are. v2.1 did not, on the intuition that a program should stand on its own graduates. The backtest showed that borrowing predicts the next class better. What is borrowed is measured graduate outcomes, not reputation, and a program with plenty of graduates keeps mostly its own result.

## 6. Overall score

| Component | Weight | Measure |
|---|---|---|
| Early-career earnings | 50% | School effect (§5), as reported |
| Graduation | 31.25% | Six-year completion, first-time full-time cohort (`C150_4`) |
| Employment | 18.75% | Working share of graduates not enrolled, 3 years after completion |

Weights are value judgments fixed a priori: v2 set 40/25/15 plus 20% for a 10-years-after-entry earnings component. **v3 removes that component from the score** because it compares entrants (including non-completers) against a completer baseline, mixing populations, cohorts and statistics. The remaining weights are renormalized proportionally. The later-earnings figure is still shown as a rough indicator.

Components are z-scored across the ranked universe (clipped at ±3). The composite is the weighted mean of available components; early earnings and graduation are required. Four scored schools lack an employment figure, and their weights are rescaled over the other two. **The 0–100 score is a relative index** (top = 100, lowest = 0), not a probability.

**Typical early earnings** (shown, not scored) is the completion-weighted mean of the school's bachelor's program medians. **Program coverage** is the share of known bachelor's completions in programs with a modeled estimate, not the share of graduates observed.

## 7. Per-major rankings

Within one major and credential, schools are ordered by the program estimate (§5): as reported by default, or with the price-aware prior and divided by the graduate price level in the alternative. Because estimates shrink by noise, the order is not the same as sorting the displayed earnings figure. Graduation and employment are not scored in major tables. Degree earnings are not occupation outcomes.

## 8. Beats expectations

The headline score minus a 10-fold cross-fitted prediction from SAT/ACT (with a missing flag), admit rate, Pell share and first-generation share. The student-profile model explains **about 61% of score variation out of fold; a typical college lands within about ±9 points of its prediction**. Only the regression is cross-fitted; score normalization and a few median-filled predictors use the full universe. It describes outcomes above or below a student-profile model; it is not a causal value-added estimate. Per-school uncertainty is not yet published, so small gaps should be read loosely.

## 9. Uncertainty and sensitivity

**Program intervals** (the basis of per-major rank ranges) combine the estimate's uncertainty with the count-independent floor, added once. They describe uncertainty in the estimate, not the spread of a future class's result. At this published width they contained the next class's result **82.8% of the time for bachelor's and 90.6% for master's** in the backtest. That is below 90%, as expected for intervals that leave out the next class's own sampling noise, and it is not a calibration of these intervals. The wider next-class prediction intervals are checked in §10.

**Rank ranges** are 5th–95th percentiles over 500 redraws of those estimates, plus, in the cost-of-living ordering only, the graduate price level where it is modeled. A price error ε moves an adjusted estimate by `(loading − 1)·ε`, with `loading = (1 − b)·β` through the prior. Graduation and employment are held fixed. **Rank ranges are conditional on the model and are not themselves empirically calibrated.** Weights and similar choices are covered by sensitivity:

| Alternative | Rank correlation with headline | Same top 25 | Median school moves |
|---|---|---|---|
| Equal weights | 0.977 | 18 | 43 places |
| Early earnings only | 0.901 | 23 | 80 |
| Without graduation | 0.934 | 23 | 67 |
| Without employment | 0.978 | 22 | 37 |
| After cost of living | 0.911 | 21 | 97 |
| Completion-weighted programs instead of the pooled school effect | 0.996 | 23 | 13 |
| Coverage floor 50% (1,155 schools) / 70% (842) | ≥ 0.9999 | 25 / 24 | 0 / 1 |

The coverage-floor rows only show that re-standardizing on a smaller universe barely moves the remaining schools; a school's own estimate does not depend on the floor.

## 10. Validation (`src/backtest.py` → `out/backtest.json`)

**Design.** Predict the 4-year earnings premium of **2017–19 graduates** (current release) from **2014–16 graduates' 4-year earnings, else 5-year** (historical files `FieldOfStudyData1819_1920` and `…1920_2021`), using the production observation model and the headline's flat prior. Completion years do not overlap; programs are matched on OPEID6 × CIP × credential. Evaluated on programs with ≥50 target earners.

**Protocol.** Institutions are split 80/20 by a fixed hash of their OPEID6. On the development 80% only, the error scale is calibrated, then a fixed grid is searched: estimator ∈ {shrink toward the major only, two-level school + program} × k ∈ {0.5, 1, 1.5, 2, 3, 4, 6, 8, 12}. The criterion is within-major RMSE, which removes each major's mean error. That offset comes from the two files building national medians differently and is shared by every estimator. The frozen choice is scored once on the 20% test institutions.

**This is a corrected retrospective evaluation, not a pristine holdout.** An earlier version of this backtest had several flaws, which an independent review caught:

- it calibrated on all institutions;
- it used a different observation model from production;
- its split was unstable;
- its coverage check counted the floor twice and re-centered errors on test outcomes.

The current calibration and grid selection exclude test targets. But the broader specification benefited from looking at the earlier results, including using one horizon, adding the floor, and the within-major criterion.

**Held-out results** (within-major error in log points ≈ percent; ρ = mean within-major rank correlation with the next class):

| | Bachelor's error | Bachelor's ρ | Master's error | Master's ρ |
|---|---|---|---|---|
| Past raw earnings | 0.091 | 0.749 | 0.097 | 0.771 |
| Major-only shrinkage, σ = 0.70 (v2.1-style) | 0.089 | 0.747 | 0.099 | 0.768 |
| **v3 two-level model** | **0.077** | **0.788** | **0.082** | 0.766 |

v3 improves prediction error for both credentials and within-major ordering for bachelor's. **For master's the ordering is on par with the simpler methods (0.766 vs 0.771)**, which is one reason master's tables stay marked experimental.

**Interval check** (test institutions, ≥50 target earners). The per-major offset between the two files' national medians is estimated on development institutions and frozen, and errors are not re-centered on test outcomes. On that basis, 90% **next-class prediction intervals** (estimate + development-fitted floor + the next class's own sampling noise) contained the next class's result **91.5% of the time for bachelor's and 93.5% for master's**. These are wider than the published program intervals, which leave out the target's sampling noise (82.8% / 90.6% at published width, §9). For the largest third of programs the figures are 90.4% and 92.4%. Without the floor, the large-program figures fall to 88.6% for both, which is why the floor is included.

**Limits.** One pair of graduating classes cannot show robustness across economic periods; the next Scorecard release is the prospective test. The backtest validates the as-reported program earnings estimates. It does not validate the geography model, the composite weights, or rank ranges.

## 11. Not yet validated (next steps)

- **Geography:** state- or system-held-out validation of destinations; Scorecard's program-level in-state counts (after cohort-matching their denominators); major- and credential-specific destinations.
- **Beats expectations:** per-school uncertainty and fold stability.
- **Prospective check** on the next Scorecard release, with the settings frozen.

## Changes

**v3.0**
- Headline ranks earnings as reported and uses no geography; cost of living is the alternative.
- Removed the 10-years-after-entry earnings component from the score (population mismatch); weights renormalized.
- Observation model: 4-year earnings, else 5-year; 1-year no longer scored.
- Error scale, floor and shrinkage multiplier calibrated and selected by a held-out next-class backtest; per-major estimates borrow from the school in proportion to their noise.
- Price prior (alternative view) gains an intercept.
- Price error propagates through prior and deflator.
- Programs matched on OPEID6.
- Unknown completions stay unknown.
- Sensitivity adds completion-weighted aggregation and coverage floors.
- Beats expectations publishes out-of-fold fit.

**v2.1**
- Per-field dollar years (v2.0 double-inflated 4-year earnings by 6.5%).
- Price-aware prior.
- Price-model error in ranges.
- Nominal ordering published.
- Cross-fitted expectations.
- Documentation corrected.

**v2.0** (from v1.2)
- Same-major earnings.
- Reputation removed (OpenAlex matching failed for 691 of 782 schools).
- Bachelor's and master's major tables.
- Branch collapse.
- Employment from graduates.
- Territories excluded.
- Overall table requires a graduation rate.
