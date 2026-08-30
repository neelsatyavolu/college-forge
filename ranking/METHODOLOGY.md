# Purchasing-power college ranking — methodology v1.2

Headline question: if you graduate from this school, how far does a typical bachelor’s paycheck go where graduates actually work — and how well-regarded is the school?

Not an ROI ranking. Net price is reported, not scored.

## Score

```
composite = 0.70 × percentile(value) + 0.30 × percentile(reputation)
value     = earnings / (RPP_grad / 100)
```

Dollars are in 2024 national-average purchasing power (PCE from Scorecard-vintage dollars).

## Earnings

College Scorecard median bachelor’s earnings four years after completion, weighted by the school’s actual major mix (field-of-study completions). Schools below 30% field-of-study coverage are dropped; 30–50% fall back to institution-level earnings.

This is the paycheck of a typical graduate, not a quality-held-constant ranking. A nursing- or CS-heavy campus will outrank a similar school with more humanities graduates. A fixed-mix (same majors everywhere) table is in `sensitivity.csv`.

Federal-aid recipients only.

## Cost of living (`RPP_grad`)

BEA Regional Price Parities, **renter-tilted**: all-items RPP plus 10 percentage points of extra housing weight (`housing RPP − all-items RPP`). Young graduates spend more on rent than the all-items basket.

**Stayers** (in-state employment share from Census PSEO, or modeled): campus-area RPP (population-weighted counties within 40 miles). Intra-state labor markets differ — Riverside is not Berkeley.

**Movers:** Census-division employment mix from PSEO destination rows (`geo_level=D`, bachelor’s, all CIP, pooled cohort), priced at population-weighted young RPP of that division. The in-state slice of the home division is repriced from the division average to campus-local RPP.

**If PSEO destinations are missing** but in-state share is observed: `s × campus RPP + (1−s) × leaver_pool`, where `leaver_pool` is the implied destination RPP of out-of-state graduates at PSEO schools — **not** the national average of 100.

**If neither is observed:** OLS on observed `RPP_grad` with control, admit rate, SAT, SAT-missing flag, enrollment, and campus RPP. Unknown SAT is not imputed as “average SAT.”

PSEO does not include every state. California schools are modeled.

v1.1 used `s × campus RPP + (1−s) × 100`. That underpriced coastal job markets for graduates leaving cheap campuses. `legacy_two_dest` in `sensitivity.csv` is that older formula.

## Reputation (30%)

IPEDS yield (40%), OpenAlex field-weighted citation impact within Carnegie class (40%), first-year retention + six-year completion (20%). Residualized on value only if Pearson r ≥ 0.5.

## What is not in the score

Tuition / net price, state income tax, teaching quality, wellbeing, fit. Graduate-school feeders (high non-working share at four years) are flagged, not adjusted.

## Universe

US main-campus, currently operating, public or private nonprofit, predominantly bachelor’s, undergraduate enrollment ≥ 500. For-profits excluded.

## Uncertainty

Bootstrap rank intervals (5th–95th) from noisy earnings. Rank gaps inside overlapping intervals are not meaningful.
