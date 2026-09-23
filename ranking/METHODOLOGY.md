# Forge career-outcomes ranking — methodology v2.1

## What this is, and what it is not

A **historical comparison of past graduates' outcomes**, built from federal administrative data on students who received federal aid.

- It **describes** where covered former students had strong earnings, completion and employment.
- It has **not been validated as a predictor** of any future student's career. No out-of-sample backtest has been run yet (see §10).
- It does **not estimate what a college causes**, including in "Beats expectations".

Use it to discover and compare schools, alongside raw figures and uncertainty, not to decide on rank order alone.

## 1. Principles

1. **Outcomes, not inputs.** Admit rate, test scores, yield, research, spending and reputation get no direct weight. (Admissions variables do appear in the destination model, §4, and the separate expectations view, §8.)
2. **Compare like with like.** Graduates are compared with graduates of the same major and credential nationally.
3. **Money means purchasing power, and both views are published.** The default adjusts for where graduates work; an unadjusted ordering is published alongside because access to high-cost labor markets can itself be a career benefit.
4. **Noise is modeled, uncertainty is shown, and its limits are stated.**
5. **Nothing is imputed.** Suppressed programs are not ranked.

Weights were fixed before results were inspected. That protects against tuning toward familiar lists; it does not show the weights are optimal predictors.

## 2. Universes

| Table | Included |
|---|---|
| Overall | Public or private nonprofit, in the 50 states or DC, operating, main campus, predominantly bachelor's, ≥500 undergraduates, not online-only; ≥30% of bachelor's completions in programs with published earnings; a first-time-student graduation rate |
| Per major (bachelor's, master's) | Any operating public or private nonprofit school in the 50 states or DC, not online-only; majors (4-digit CIP) with ≥20 ranked schools; the top 250 under either ordering are published |

Territories are excluded because BEA publishes no price parities for them. Scorecard reports field-of-study earnings per OPEID6, so branch campuses repeating their parent's cells are collapsed into one program credited to the main campus.

## 3. Data, cohorts and dollars

| Field | Who, when (June 10, 2026 release) | Source dollars |
|---|---|---|
| `EARN_MDN_4YR`, `EARN_MDN_4YR_NAT` | 2017–19 graduates, earnings in 2022–23 | 2024 |
| `EARN_MDN_5YR` | 2014–16 graduates, earnings in 2020–21 | 2022 |
| `EARN_MDN_1YR` | 2018–20 graduates, earnings in 2020–21 | 2022 |
| `MD_EARN_WNE_P10` | students who entered 2009–11, earnings in 2020–21 | 2022 |

Source dollar years come from the Scorecard data dictionary's cohort maps and are pinned per field in `config.FIELD_DOLLAR_YEAR`. Every field is restated in **2024 dollars** at load with the PCE index. `tests/test_data_contract.py` checks published figures against the official file.

"Earnings" are annual W-2 wages plus positive self-employment earnings, for federal aid recipients working and not enrolled. They are not base salaries. International students are not covered.

## 4. Cost of living (`RPP_grad`)

BEA Regional Price Parities with 10 extra percentage points of housing weight (`all-items + 0.10 × (housing − all-items)`), a young-renter basket. Graduates who stay in-state are priced at the campus labor market (population-weighted counties within 40 miles). Graduates who leave are priced at Census-division destinations from Census PSEO.

**Most schools are modeled.** PSEO destinations are observed for about a quarter of schools (460 of 1,740 in this run). The rest are predicted from control, admit rate, SAT, a missing-SAT flag, enrollment and campus prices (cross-validated R² ≈ 0.90; held-out log error ≈ 0.016, about 1.6% of the price level). That target is itself constructed from coarse destinations, and in-state is not the same as near campus, so a good R² is not external validation.

The same bachelor's-graduate estimate is used for every major and for master's programs. Dividing a median by a price index approximates, but does not equal, the median of price-adjusted earnings. State taxes are not deducted.

## 5. Program premium

For each program (school × 4-digit CIP × credential) and each published horizon h ∈ {1, 4, 5 years after completion}:

```
y_h = ln(program median_h / national median_h, same major and credential)
```

National medians: Scorecard's `EARN_MDN_4YR_NAT` at 4 years; earner-weighted medians of program medians at 1 and 5 years (not the median of all individuals). Horizons are pooled by precision. The sampling variance of a median is taken as `(1.2533 · 0.70)² / n`, an assumption rather than a published standard error. The 1-year horizon counts half. Pooled horizons combine different graduating cohorts; they are not one class's career path.

**Price-aware prior.** Nominal premiums rise with local prices (estimated slope β ≈ 0.75 for bachelor's, 0.93 for master's). Estimates shrink toward `β · ln(RPP_grad/100)`, what a program with no data would be expected to earn where its graduates work. Shrinking toward zero instead would lift data-poor programs in cheap regions and push down those in expensive regions after the cost-of-living adjustment.

There are **two different shrinkage models**, one per question:

- **School effect (overall ranking).** A school's programs are pooled into one school effect (programs deviate from it with SD ω). The school effect is shrunk toward the price-aware prior in proportion to how little data the school has (school SD τ). This is what the overall score uses.
- **Program estimate (per-major rankings).** Each program is shrunk toward the price-aware prior by `b = τ_m² / (τ_m² + se²)`, where τ_m is the spread of programs within that major. **It never borrows the school's results in other majors**: a strong university does not lift a small program's major rank.

## 6. Overall score

| Component | Weight | Measure |
|---|---|---|
| Early-career earnings | 40% | School effect (§5), minus ln(RPP_grad/100) |
| Later earnings indicator | 20% | ln(`MD_EARN_WNE_P10` ÷ RPP_grad) − ln(completion-weighted mean of national 5-year medians for the school's bachelor's majors). Measured 10 years after *entry* (≈6 years after a four-year graduation), for entrants including non-completers. It is a rough proxy that partly overlaps graduation, not a same-major long-run premium. |
| Graduation | 25% | Six-year completion, first-time full-time cohort (`C150_4`) |
| Employment | 15% | Working share of graduates not enrolled, 3 years after completion |

Each component is z-scored across the ranked universe and clipped at ±3. The composite is the weighted mean of available components (early earnings and graduation are required; a missing optional component renormalizes the weights). **The 0–100 score is a relative index:** the top school is 100 and the lowest is 0. It is not a probability or a percentage of anything.

Weights are value judgments. Earnings get 60% as the most direct financial measure. Graduation gets 25% because a degree pays only if completed. Employment gets 15%, though after z-scoring its narrow spread still counts. The components describe different populations and horizons; together they are an index, not an expected-outcome estimate for a new student.

Scorecard's 10-years-after-entry *employment* counts are not used; they report, for example, 38% of Babson entrants working versus 96% of its graduates three years after completion.

**Typical early earnings** (shown, not scored) is the completion-weighted mean of the school's bachelor's program medians (4-year where published, else 5- or 1-year). It is not the median of all graduates. **Program coverage** is the share of bachelor's completions in programs with published earnings. It is not the share of graduates whose earnings are observed.

## 7. Per-major rankings

Within one major and credential, schools are ordered by the modeled premium from §5 (after cost of living by default; before it in the alternative ordering). Because it pools horizons and shrinks unevenly, this order is **not** the same as sorting by the single displayed earnings figure. Graduation and employment are not scored in major tables. Earnings are for people who earned the degree, whatever their occupation: journalism-degree earnings are not a measure of journalism careers.

## 8. Beats expectations

The overall score minus a **cross-fitted** prediction (10-fold OLS on SAT/ACT with a missing flag, admit rate, Pell share, first-generation share; medians fill a few missing predictors). It describes outcomes above or below a student-profile model. It is not a causal value-added estimate: unmeasured preparation, resources, preferences, age and model error all enter the residual. No uncertainty is published for it yet.

## 9. Uncertainty and sensitivity

Rank ranges are the 5th–95th percentiles over 500 redraws of each earnings estimate and, for schools with modeled destinations, their price level (shared across both earnings components). Graduation and employment are fixed.

**The ranges are conditional on this model.** They do not cover weights, the housing basket, national baselines, the 0.70 dispersion assumption, shrinkage hyperparameters, dependence across horizons, selection into the data, or future labor markets. They have not been empirically calibrated. Overlapping ranges are a reason not to over-read the exact order; they do not show two schools are equal.

Between-specification sensitivity is published separately (`sensitivity.csv`, shown on the page): equal weights, earnings only, early earnings only, no graduation, no employment, and no cost-of-living adjustment. The no-cost-of-living ordering is the one that moves individual schools most (Spearman ≈ 0.89), so it is published as a full alternative ranking.

## 10. Not yet validated (next steps)

- **Predictive backtest:** build the model from an earlier Scorecard release and test it against later cohorts, compared with simple baselines (latest raw program earnings, national major median, a school-level indicator).
- **Geography:** hold out states or university systems, report absolute price-level and rank errors, test campus-local versus statewide pricing, and estimate major- and credential-specific destinations.
- **Calibration:** check rank-range coverage using release-to-release changes.
- **Beats expectations:** publish its model fit and uncertainty.

## Changes

**v2.1**
- Each earnings field is restated to 2024 dollars from its documented source year. v2.0 inflated every displayed figure from an assumed 2022 base, overstating 4-year figures (already 2024 dollars) by 6.5%. That error was display-only. A related one was not: the later-earnings baseline mixed 2022- and 2024-dollar references where 5-year medians were missing.
- Price-aware shrinkage prior for both models. Together with the baseline fix, the median school moved 1 place and the top 25 is unchanged. The largest moves were data-poor schools in high-cost areas (Pomona #130→#109, Caltech #79→#64) that the zero prior had penalized.
- Rank ranges include price-model error for modeled schools.
- An unadjusted (nominal) ordering is published.
- "Beats expectations" is cross-fitted.
- Methodology corrected to describe the two shrinkage models and the major ordering accurately.
- Relabeled coverage and typical earnings; per-horizon earner counts; unknown completions shown as unknown.

**v2.0** (from v1.2)
- Same-major earnings instead of major mix.
- Reputation removed; OpenAlex name matching had failed for 691 of 782 schools.
- Bachelor's and master's major tables with shrinkage and top 250.
- Pooled horizons.
- Branch-campus collapse.
- Employment from graduates 3 years out.
- Territories excluded.
- Overall table requires a graduation rate.
