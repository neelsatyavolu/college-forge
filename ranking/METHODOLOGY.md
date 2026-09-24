# Forge career-outcomes ranking — methodology v3.2

## What this is, and what it is not

A **comparison of past graduates' outcomes**, from federal administrative data on students who received federal aid. The program earnings estimates behind it, **as reported (before any cost-of-living adjustment)**, were checked in an **exploratory retrospective evaluation**: built only from earlier graduating classes, they predicted the next classes' earnings better than the alternatives tested, on institutions excluded from calibration and selection (§10). Earlier results informed revisions, so this is not an untouched confirmatory test.

- It **describes** where covered former students had strong earnings, completion and employment.
- The backtest does **not** validate the cost-of-living adjustment (applied at half weight in the page's default view), the composite weights, or the rank ranges (§4, §9, §10).
- It does **not estimate what a college causes**, including in "Beats expectations", and it is not a forecast for any individual student.

## 1. Principles

1. **Outcomes, not inputs.** Admit rate, test scores, yield, research, spending and reputation get no direct weight. (Admissions variables appear only in the graduate-destination model for the cost-of-living view, §4, and in the separate expectations view, §8.)
2. **Compare like with like.** Graduates are compared with graduates of the same major and credential nationally.
3. **Three orderings, clearly labeled.** Cost of living counts **half by default** (§4), a stated value judgment. Where graduates work is modeled for about three-quarters of schools and not externally validated. **None** (earnings as reported, no geography) and **Full** (pure local purchasing power) are one click away. The as-reported ordering is the one the backtest checks (§10) and the reference for the sensitivity table (§9). Every row shows its rank in the other orderings.
4. **Model choices are made by prediction, not by how the list looks.** Where the data can decide (error scale, how much to shrink, whether to pool with the school, how to use older 5-year earnings), the choice was made by held-out prediction on development institutions (§10). Component weights are value judgments fixed before results were inspected.
5. **Nothing is imputed.** Suppressed programs are not ranked; unknown completion counts stay unknown.

## 2. Universes

| Table | Included |
|---|---|
| Overall (1,281 schools) | Public or private nonprofit, in the 50 states or DC, operating, main campus, predominantly bachelor's, ≥500 undergraduates, not online-only; ≥30% of known bachelor's completions in programs with a modeled earnings estimate; a first-time-student graduation rate |
| Per major (156 bachelor's, 85 master's) | Any operating public or private nonprofit school in the 50 states or DC, not online-only; majors (4-digit CIP) with ≥20 ranked schools. The page shows the top 250 in the active ordering; the files hold the top 250 under either ordering so switching never drops a school |

Territories are excluded (no BEA price parities). Programs are identified by OPEID6 × CIP × credential; branch campuses repeating a parent's cells are collapsed into one program credited to the main campus.

## 3. Data, cohorts and dollars

| Field | Who, when (June 10, 2026 release) | Source dollars | Use |
|---|---|---|---|
| `EARN_MDN_4YR`, `EARN_MDN_4YR_NAT` | AY2017–18 and AY2018–19 graduates (two pooled years), earnings in CY2022–23 | 2024 | Scored |
| `EARN_MDN_5YR` | AY2014–15 and AY2015–16 graduates, earnings in CY2020–21 | 2022 | Scored where 4-year is suppressed, shifted onto the 4-year scale (§5); 3,136 of 34,637 ranked programs |
| `EARN_MDN_1YR` | AY2018–19 and AY2019–20 graduates, earnings in CY2020–21 | 2022 | Not scored |
| `MD_EARN_WNE_P10` | students who entered 2009–11, earnings in 2020–21 | 2022 | Shown, not scored |
| `COUNT_WNE_3YR`, `COUNT_NWNE_3YR` | AY2014–16 graduates, working status in 2018–19 | — | Employment (scored) |
| `C150_4` | first-time full-time students starting around fall 2018 | — | Graduation (scored) |
| `C150_4_PELL`, `D150_4_PELL` | the same cohort's first-year Pell Grant recipients, and their count | — | Shown, not scored |

Dollar years come from the data dictionary's cohort maps (`config.FIELD_DOLLAR_YEAR`); every field is restated in **2024 dollars** at load. `tests/test_data_contract.py` checks published figures against the official file for both modeled horizons, both credentials and a branch-campus group. "Earnings" are annual W-2 wages plus positive self-employment earnings for federal aid recipients working and not enrolled — not base salaries, and not international students.

## 4. Cost of living (half weight by default; exploratory)

**How much it counts.** A view with weight `w` ranks `premium − w·ln(P/100)`, where `P` is the graduate price level: `w = 0` is earnings as reported, `w = 1` is full local purchasing power, and the page default is **`w = 0.5`** (`config.COST_OF_LIVING_WEIGHT`), exactly halfway between the two in log earnings, i.e. earnings divided by `√(P/100)`. The rationale is equal weight on two things a student cares about: what the degree earns in the job market, which travels with the graduate, and what that pay buys where graduates actually live. **This is a value judgment, like the component weights, not an estimate.** Our data cannot identify a "correct" weight. Two arguments sometimes offered for a particular value do not settle it. Research finds that roughly half of the big-city earnings premium comes from experience that stays with a worker after moving (De la Roca & Puga 2017), but all current earnings still face current local prices. Untaxed amenities argue for less adjustment; state taxes, which are not deducted, argue for more. The weight was set after seeing how the orderings compare, so it is disclosed as chosen, not pre-registered. Against the as-reported ordering, the half view has rank correlation 0.984 and a median move of 39 places; the full view, 0.911 and 97 (§9).

**Measurement.** BEA Regional Price Parities with 10 extra percentage points of housing weight (a young-renter basket). In-state graduates are priced at the campus labor market (counties within 40 miles); leavers at Census-division destinations from PSEO.

**Coverage, from the current run (`out/diagnostics.json`).** The geography step covers **1,717 schools**: every school eligible for the overall table or with a program earnings estimate, before ranking filters (1,677 of them appear in a published ranking).

| Denominator | Schools |
|---|---|
| PSEO in-state share observed | 460 |
| PSEO destinations observed (price level observed) | 458 |
| Regression training cases (destinations plus the model's other inputs) | 456 |
| Price level modeled by regression | 1,257 (73%) |
| In-state share observed, destinations not: two-bucket estimate | 2 |
| Overall-ranked colleges with observed destinations | 408 of 1,281 |

Modeled price levels carry the held-out error of the estimator actually used: log error ≈ 0.016 for the regression and ≈ 0.011 for the two-bucket estimate (in-state share at campus prices, leavers at the implied leaver pool, scored where destinations are observed). Observed destinations carry no price error in the ranges; their approximation error is not quantified.

**Why it is exploratory.** The observed target itself is built from coarse destinations and campus-local prices, so the regression's fit is not external validation, and in-state is not the same as near campus. Other unvalidated choices: the extra housing weight, no state-tax deduction, undergraduate destinations applied to every major and to master's programs, and independent modeled errors across schools. The as-reported ordering avoids all of these assumptions. Because the price-aware prior expects higher nominal pay in expensive places, a heavily shrunk estimate whose price loading exceeds `w` rises slightly with its estimated price level; this affects 14 of 34,637 ranked programs in the half view.

## 5. Program estimates

**Observation.** For each program (school × 4-digit CIP × credential):

```
y = ln(program median / national median for the same major and credential)
```

using **4-year earnings, else 5-year**. Only one horizon is used per program: the 4- and 5-year figures describe different classes and are not independent measurements. 1-year earnings (partly pandemic years, overlapping the next class) are not scored.

**Putting 5-year earnings on the 4-year scale (v3.1).** A 5-year figure describes a class three years older, at a different horizon, against a different baseline: Scorecard publishes no 5-year national median, so the 5-year baseline is an earner-weighted median of program medians. Among programs that publish both, the gap `y5 − y4` averages near zero overall but differs by major (fitted shifts: +0.11 for master's music, +0.11 for bachelor's health administration, −0.14 for master's legal studies). So each fallback program uses

```
y = y5 − shift(major)
```

where `shift(major)` is the major's mean gap among programs publishing both (equal weight per program), shrunk by empirical Bayes toward the credential mean. A major with no matched programs gets the credential mean. The posterior variance of the shift is added to the program's sampling variance. The mapping is fitted once and applied frozen. It was chosen over "no correction" and "one shift per credential" on development institutions and confirmed on held-out ones (§10). Two caveats remain. Matched programs are larger than fallback programs (median 44 vs 20 five-year earners among bachelor's), so the check covers substitution where both figures are visible. And the shift's uncertainty is treated as independent across programs, although programs in one major share it. That uncertainty is small next to program sampling error (SD up to about 0.03 for bachelor's, 0.06 for master's in majors with few matched programs).

**Error scale (calibrated).** The sampling variance of a median is taken as `(1.2533 · σ)² / n`. σ is an **effective, count-dependent error scale**, fitted on development institutions from how much the same programs moved between classes with no overlapping completion years. Each major's systematic shift is removed first, and the fit is non-negative. **σ = 0.454 for bachelor's, 0.383 for master's**; v2 assumed 0.70. The same fit gives a **count-independent floor** (SD 0.019 bachelor's, 0.048 master's): change between classes that does not shrink with program size.

**Two-level model (selected by backtest).** Program premium = school effect + program deviation + noise.

- **School effect** (overall ranking): a school's programs are pooled, `m_s` = precision-weighted mean with variance `v_s`, then shrunk toward a prior: `μ̂_s = m0 + b_s·(m_s − m0)`, `b_s = τ² / (τ² + v_s)`, posterior SD `√(b_s·v_s)`. The prior `m0` is the typical premium α (≈ 0) for the as-reported ordering. For the cost-of-living views it is `α + β·ln(RPP/100)` (β ≈ 0.82 bachelor's, 1.00 master's: nominal pay rises with local prices).
- **Program estimate** (per-major rankings): the program's own premium, shrunk toward its school's effect by `b_p = ω² / (ω² + s²)`, where `s² = k·(1.2533σ)²/n` (+ the 5-year mapping variance for fallback programs), with **k = 1.5 bachelor's, 2 master's** chosen by next-class prediction. Its SD is `√(b_p·s² + (1 − b_p)²·SD(μ̂_s)² + floor²)`.

**A program therefore borrows from its own school's results in other majors**, in proportion to how noisy its own data are. The backtest showed that borrowing predicts the next class better than judging each program alone. What is borrowed is measured graduate outcomes, not reputation, and a program with plenty of graduates keeps mostly its own result.

**Price loadings** (how a price-level error ε moves an estimate through the prior, cost-of-living views only): `(1 − b_s)·β` for a school effect, `(1 − b_p)·(1 − b_s)·β` for a program estimate. The adjustment then subtracts `w·ε`, so the net effect is `(loading − w)·ε`.

## 6. Overall score

| Component | Weight | Measure |
|---|---|---|
| Early-career earnings | 50% | School effect (§5) |
| Graduation | 31.25% | Six-year completion, first-time full-time cohort (`C150_4`) |
| Employment | 18.75% | Working share of graduates not enrolled, 3 years after completion |

Weights are value judgments fixed a priori: v2 set 40/25/15 plus 20% for a 10-years-after-entry earnings component. **v3 removes that component from the score** because it compares entrants (including non-completers) against a completer baseline, mixing populations, cohorts and statistics. The remaining weights are renormalized proportionally. They are not estimated coefficients for career success. The later-earnings figure is still shown as a rough indicator.

Components are z-scored across the ranked universe (clipped at ±3). The composite is the weighted mean of available components; early earnings and graduation are required. Four scored schools lack an employment figure, and their weights are rescaled over the other two. **The 0–100 score is a relative index** (top = 100, lowest = 0), not a probability.

**Pell graduation** (shown, not scored) is the six-year completion rate of first-year Pell recipients in the graduation cohort, with the gap to all students and the cohort size (median 199; 23 overall-ranked schools have fewer than 30). It is not scored because adding a component is a weight decision, and weights are fixed a priori (§1.4).

**Typical early earnings** (shown, not scored) is the completion-weighted mean of the school's bachelor's program medians. **Program coverage** is the share of known bachelor's completions in programs with a modeled estimate, not the share of graduates observed. **Older data** is the share of a school's scored bachelor's programs that use 5-year earnings; rows where it exceeds half are flagged (34 scored schools).

## 7. Per-major rankings

Within one major and credential, schools are ordered by the program estimate (§5): by default with the price-aware prior and half the cost-of-living adjustment (§4), or with none or all of it. Because estimates shrink by noise, the order is not the same as sorting the displayed earnings figure. Programs scored on 5-year earnings are labeled "older class", and each table states its share of them. Graduation and employment are not scored in major tables. Degree earnings are not occupation outcomes. Search and filters work within the published top 250.

## 8. Beats expectations

The as-reported score minus a 10-fold cross-fitted prediction from SAT/ACT (with a missing flag), admit rate, Pell share and first-generation share. The student-profile model explains **about 61% of score variation out of fold; a typical college lands within about ±9 points of its prediction**. Only the regression is cross-fitted; score normalization and a few median-filled predictors use the full universe. It describes outcomes above or below a student-profile model; it is not a causal value-added estimate. Per-school uncertainty is not yet published, so small gaps should be read loosely.

## 9. Uncertainty and sensitivity

Four things are kept apart: uncertainty in an estimate; the wider spread of a future class's result; rank variation within a fixed model; and sensitivity to changing the model.

**Program intervals** (the basis of per-major rank ranges) use the program SD in §5, which includes the count-independent floor once. They describe uncertainty in the estimate, not the spread of a future class's result. At this published width they contained the next class's result **82.8% of the time for bachelor's and 90.6% for master's** in the backtest. That is below 90% for bachelor's, as expected for intervals that leave out the next class's own sampling noise, and it is not a calibration of these intervals.

**School intervals** (the basis of overall rank ranges) use the school effect's posterior SD `√(b_s·v_s)` without a separate floor. That is a different estimand: independent program-level class-to-class change largely averages out across a school's programs. School-level prediction has not been separately backtested.

**Rank ranges** are 5th–95th percentiles over 500 redraws of those estimates, plus, in the cost-of-living orderings only, the graduate price level where it is estimated (net effect `(loading − w)·ε`, §5). Graduation and employment are held fixed. **Rank ranges are conditional on the fitted model and are not themselves empirically calibrated.** Weights and similar choices are covered by sensitivity:

| Alternative (vs. the as-reported ordering) | Rank correlation | Same top 25 | Median school moves |
|---|---|---|---|
| Equal weights | 0.977 | 19 | 43 places |
| Early earnings only | 0.901 | 22 | 81 |
| Without graduation | 0.934 | 23 | 66 |
| Without employment | 0.978 | 22 | 36 |
| Half cost of living (the page default) | 0.984 | 22 | 39 |
| Full cost of living | 0.911 | 20 | 97 |
| Completion-weighted programs instead of the pooled school effect | 0.996 | 23 | 13 |
| Only 4-year earnings (drop older 5-year data; 1,276 schools) | 0.995 | 24 | 7 |
| Coverage floor 50% (1,155 schools) / 70% (842) | ≥ 0.9999 | 25 / 25 | 0 / 1 |

The coverage-floor rows only show that re-standardizing on a smaller universe barely moves the remaining schools; a school's own estimate does not depend on the floor.

## 10. Validation (`src/backtest.py` → `out/backtest.json`)

**Design.** Predict the 4-year earnings premium of **AY2017–19 graduates** (current release) from **AY2014–16 graduates' 4-year earnings, else 5-year mapped onto the 4-year scale** (historical files `FieldOfStudyData1819_1920` and `…1920_2021`), using the production observation model and the as-reported ordering's flat prior. Completion years do not overlap; programs are matched on OPEID6 × CIP × credential. The headline set is programs whose later class has ≥50 earners. It conditions on programs that exist and publish in both periods; it says nothing about closed, new or suppressed programs.

**Protocol.** Institutions are split 80/20 by a fixed hash of their OPEID6. On the development 80% only: the 5-year mapping level is chosen (cross-fitted, below), the historical mapping fitted, the error scale calibrated, then a fixed grid searched (estimator ∈ {shrink toward the major only, two-level school + program} × k ∈ {0.5, 1, 1.5, 2, 3, 4, 6, 8, 12}) by major-centered RMSE. The frozen choice is scored on the 20% test institutions. Historical inputs from test institutions do enter fitting (their own school effects and shared parameters). This is an **outcome holdout** for known schools, not cold-start prediction. `tests/test_backtest.py` checks end to end (`backtest.protocol`) that scrambling test institutions' current outcomes changes no calibration, selection or mapping choice.

**Error measures** (log points ≈ percent):

- **major-centered RMSE** ("typical miss"): each method's own mean error per major on the evaluated rows is removed. It isolates ordering within a major but also absorbs a method's major-wide bias and major-wide changes between classes;
- **dev-offset RMSE**: per-major offsets estimated on development institutions and frozen;
- **uncentered RMSE**.

**This is an exploratory retrospective evaluation, not a pristine holdout.** An earlier version of this backtest had several flaws, which an independent review caught:

- it calibrated on all institutions;
- it used a different observation model from production;
- its split was unstable;
- its coverage check counted the floor twice and re-centered errors on test outcomes.

The current calibration and selection exclude test targets. But the specification benefited from looking at earlier results, including using one horizon, adding the floor, and the major-centered criterion. A clean test needs the next Scorecard release with settings frozen.

**Held-out results** (headline set). ρ is the within-major rank correlation with the next class, averaged with equal weight over majors with ≥20 held-out programs.

| | Bach. centered | Bach. uncentered | Bach. ρ | Mast. centered | Mast. uncentered | Mast. ρ |
|---|---|---|---|---|---|---|
| Past raw earnings | 0.091 | 0.099 | 0.749 | 0.097 | 0.130 | 0.771 |
| Major-only shrinkage, σ = 0.70 (v2.1-style) | 0.089 | 0.096 | 0.747 | 0.099 | 0.119 | 0.768 |
| Major-only shrinkage, best k on development (k = 1) | 0.084 | 0.091 | 0.751 | 0.090 | 0.118 | 0.770 |
| **v3 two-level model** | **0.077** | **0.084** | **0.788** | **0.082** | **0.107** | 0.766 |

**Denominators.**

| | Bachelor's | Master's |
|---|---|---|
| Held-out programs (headline) | 1,931 at 225 institutions | 565 at 161 institutions |
| In centered RMSE (majors with ≥5 programs) | 1,709 programs, 69 majors | 457 programs, 24 majors |
| In ρ (majors with ≥20 programs) | 1,298 programs, 27 majors | 295 programs, 9 majors |

**Uncertainty in the comparison** (90% intervals, resampling institutions). Centering is recomputed within each draw. The two-level model's centered RMSE is lower than raw earnings' by 1.1–1.7 points (bachelor's) and 0.6–2.3 (master's). It is lower than the best major-only method's by 0.5–0.8 and 0.1–1.3. **For master's the ordering is on par with raw earnings (ρ 0.766 vs 0.771, over only nine majors)**, one reason master's tables stay marked experimental.

**Stability.** Rerunning the whole protocol, mapping-level choice included, on five other institution splits (an independent SHA-256 hash per split) chose the same mapping level, estimator and k every time. Centered RMSE beat raw earnings in 5 of 5 splits for both credentials. ρ beat raw earnings in 5 of 5 for bachelor's but only 2 of 5 for master's. Master's k = 2 narrowly beat k = 1.5 on development data (0.0849 vs 0.0855); it is not a sharp optimum.

**Other held-out strata.**

| | Programs | Centered (this / raw) | Uncentered (this / raw) |
|---|---|---|---|
| Bachelor's, later class < 50 earners | 1,778 | 0.119 / 0.153 | 0.128 / 0.161 |
| Master's, later class < 50 earners | 572 | 0.108 / 0.118 | 0.132 / 0.151 |
| Estimate built from 5-year earnings | 10 / 3 | too few to measure | |

Most published rows are small programs; their errors are larger than the headline figures, but the model still beats raw earnings there. For those small programs, 90% next-class prediction intervals held 92.1% (bachelor's) and 93.2% (master's) of the time; at the published width, 74.4% and 86.0%.

**5-year mapping check** (`horizon_test`). The past side has almost no fallback cases, so the mapping is checked directly in the current release. The check uses programs publishing both horizons, 5-year = a class three years older, the same setting as production. The level is chosen by cross-fitted RMSE on development institutions, and that choice is what the historical backtest uses. Separately, a release gate decides what production ships: the level ships only if, on test institutions, it does not raise uncentered RMSE versus no correction, overall or for programs with <30 five-year earners (otherwise no correction). The gate was fixed before scoring test institutions, after an exploratory look at pooled matched data. It uses test outcomes, so it feeds only the production setting, never the backtest's own calibration or selection. Both chose the per-major shift.

| Predicting y4 from y5, held out | Programs | No correction | One shift per credential | **Per-major shift** | 90% interval coverage (per-major; <30 earners) |
|---|---|---|---|---|---|
| Bachelor's | 3,590 at 271 institutions | 0.125 | 0.124 | **0.122** | 90.7%; 91.8% |
| Master's | 1,104 at 209 institutions | 0.139 | 0.139 | **0.132** | 90.4%; 90.4% |

For programs with <30 five-year earners: 0.160 → 0.159 (bachelor's), 0.162 → 0.155 (master's). The per-major shift's gain over no correction is 0.2–0.3 points (bachelor's) and 0.3–1.0 (master's) at 90% (institution bootstrap). Intervals use `(1.2533σ)²(1/n4 + 1/n5) + floor² + Var(shift)`.

**Interval check** (headline set, test institutions). Per-major offsets come from development institutions, frozen; errors are not re-centered on test outcomes. 90% **next-class prediction intervals** (estimate + floor + the next class's own sampling noise, which uses that class's observed earner count, so these are conditional retrospective intervals) contained the next class's result **91.5% (bachelor's) and 93.5% (master's)** of the time. For the largest third of programs: 90.4% and 92.4%. Without the floor, the large-program figures fall to 88.6% for both. At the published width (no target noise): 82.8% and 90.6%.

**Provenance.** `backtest.json` and the public `validation.json` record the generation time, code commit (and whether the ranking code had uncommitted changes), SHA-256 of every ranking source file and of each input file. `tests/test_backtest_pins.py` checks that config pins match that artifact; it reads the artifact rather than recomputing it.

**Limits.** One pair of graduating classes cannot show robustness across economic periods. The backtest validates the as-reported program earnings estimates. It does not validate the geography model, the composite weights, school-level aggregates, or rank ranges.

## 11. Not yet validated (next steps)

- **Geography:** state- or system-held-out validation of destinations; Scorecard's program-level in-state counts (after cohort-matching their denominators); major- and credential-specific destinations.
- **5-year mapping:** shared-by-major uncertainty in rank simulations.
- **School level:** backtest of school effects and their intervals, separate from programs.
- **Beats expectations:** per-school uncertainty and fold stability.
- **Prospective check** on the next Scorecard release, with the protocol frozen.

## Changes

**v3.2**
- Cost of living counts half by default (`w = 0.5`, a stated value judgment); none and full are one click away. Price-error propagation generalized to `(loading − w)·ε`. The recommendation engine and per-school major ranks follow the default. Major tables show the overall rank for the active view.
- Pell graduation (`C150_4_PELL`) shown on each college, not scored; scores and ranks unchanged.

**v3.1**
- 5-year fallback earnings mapped onto the 4-year scale (per-major shrunk shift), chosen on development institutions and checked on held-out ones; mapping uncertainty added to program variance.
- Four-year-only sensitivity row; "older data" share per college and per major table; fallback rows labeled.
- Validation reports uncentered and dev-offset errors, the development-tuned major-only challenger, metric-specific denominators, institution-bootstrap intervals (centering recomputed per draw), small-program and fallback strata with small-program interval coverage, five repeated splits of the full protocol, and provenance hashes. The status is renamed "exploratory retrospective evaluation".
- End-to-end test that held-out outcomes cannot change calibration, selection or mapping; the test-scored release gate is kept out of the backtest.
- In-state-only schools' price levels carry the two-bucket estimator's own held-out error (was the regression's).
- Geography coverage counts regenerated from the run, with each denominator labeled; school and program uncertainty formulas and price loadings documented separately.
- Page: the default (cost-of-living) view is labeled exploratory, the "backtested" badge is removed, each row shows its rank in the other ordering, and major tables show the top 250 of the active ordering (not the union of both).

**v3.0**
- Two orderings: as reported (no geography; checked by the backtest) and after cost of living (the page default since v3.0.1).
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
