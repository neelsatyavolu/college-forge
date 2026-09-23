# Forge career-outcomes ranking — methodology v2.0

**Question:** if you study a given major at this school, how do graduates do in their careers compared with people who studied the same thing elsewhere?

The ranking scores **outcomes only**. Nothing about how hard a school is to get into, how much it spends, how much research it publishes, or what anyone thinks of it enters the score. Weights were fixed before any results were looked at and are not tuned to make the list look familiar.

## 1. Principles

1. **Outcomes, not inputs.** Admit rate, test scores, yield, research output, spending and reputation surveys reward exclusivity and wealth, not what a school does for its students.
2. **Compare like with like.** A school's graduates are compared with graduates of the *same major and credential* nationally. A school is not rewarded for teaching more engineers or penalized for teaching more teachers.
3. **Money means purchasing power.** Earnings are adjusted for the cost of living where graduates actually work.
4. **Noise is modeled, not hidden.** Small programs are partially pooled toward what the rest of the data implies. Every rank has a published range.
5. **Nothing is imputed.** Core components are required; a missing optional component (long-run earnings, employment) is left out of that school's weighted average. Suppressed programs are not ranked.

## 2. Universes

| Table | Who is included |
|---|---|
| Overall | Public and private nonprofit in the 50 states or DC, currently operating, main campus, predominantly bachelor's, ≥500 undergraduates, not online-only; ≥30% of bachelor's completions in programs with published earnings; a first-time-student graduation rate |
| Per major (bachelor's, master's) | Any operating public or private nonprofit school in the 50 states or DC that is not online-only, for each 4-digit CIP major with ≥20 ranked schools; top 250 published |

For-profit institutions are excluded. Schools in U.S. territories are excluded because BEA publishes no price parities for them and their graduates work in separate labor markets; comparing them with mainland national medians would measure the territory, not the school. Scorecard publishes field-of-study earnings per OPEID6, so branch campuses that repeat their parent's figures are collapsed into one program credited to the main campus.

## 3. Program earnings premium

For each program (school × 4-digit CIP × credential) and each horizon Scorecard publishes (1, 4 and 5 years after completion):

```
premium_h = ln(program median earnings_h / national median_h for the same major and credential)
```

National medians are Scorecard's `EARN_MDN_4YR_NAT` for the 4-year horizon and earner-weighted medians across all institutions for the others. Horizons are pooled by precision (earner counts); the 1-year horizon counts half because first-year pay is a weaker career signal.

**Partial pooling (two-level empirical Bayes).** Program premium = school effect + program deviation + sampling noise. The sampling variance of a median is `(1.2533 · 0.70)² / n`. Program estimates shrink toward their **own school's** effect, and the school effect shrinks toward the national average in proportion to how little data the school has. Variance components (τ for schools, ω for programs) are estimated by method of moments, separately for bachelor's and master's.

Shrinking every program straight to the national mean (a common shortcut) is wrong here: it erases the signal from strong schools whose programs are individually small.

**Cost of living.** `premium_pp = premium − ln(RPP_grad / 100)`. `RPP_grad` is the BEA Regional Price Parity where graduates work, with 10 extra percentage points of housing weight for young renters. Stayers are priced at the campus labor market (population-weighted counties within 40 miles). Movers are priced at Census-division destinations from PSEO where observed, otherwise modeled (see v1.2 notes in `destinations.py`). State income tax is not deducted.

## 4. Overall score

| Component | Weight | Measure |
|---|---|---|
| Early-career earnings | 40% | School effect from §3 (bachelor's), cost-of-living adjusted |
| Long-run earnings | 20% | ln(median earnings 10 years after entry, cost-of-living adjusted ÷ national 5-year median for the school's bachelor's major mix) |
| Graduation | 25% | Six-year completion rate (`C150_4`) |
| Employment | 15% | Working share of graduates not enrolled, 3 years after completion |

Each component becomes a z-score across the ranked universe (clipped at ±3). The composite is the weighted mean of the components a school has. Early-career earnings and graduation are required: the overall table is for students starting college, so health-science centers, upper-division and graduate-only schools (which report no first-time-student graduation rate) appear only in the per-major tables instead of being scored on a subset of components. The published 0–100 score rescales the composite so the top school is 100 and the lowest is 0.

Why these weights: earnings are the most direct career measure and get 60% in total, weighted toward early career because it is observed for every major. Graduation gets 25% because a degree only pays if you finish. Employment gets 15% because it varies less across schools and partly reflects local labor markets.

Scorecard's 10-years-after-entry *employment* counts are not used: they report, for example, 38% of Babson entrants working versus 96% of its graduates three years after completion, which tracks self-employment and living abroad more than career access.

## 5. Per-major rankings

Within one major and credential, schools are ranked on the pooled, cost-of-living-adjusted premium from §3. Because everyone in the table is compared with the same national median, this is the same ordering as cost-of-living-adjusted earnings. Only the program's own outcomes are scored; the school's overall score is shown for context.

## 6. Uncertainty

Rank ranges are the 5th–95th percentiles over 500 redraws of each earnings estimate from its posterior uncertainty. Graduation and employment rates are treated as fixed. Schools whose ranges overlap are not meaningfully different.

## 7. Beats expectations

A secondary table regresses the overall composite on incoming-student characteristics (SAT/ACT with a missing flag, admit rate, Pell share, first-generation share) and ranks schools by the residual. It answers a different question: which schools' graduates do better than their student body alone would predict. It does not replace the headline score.

## 8. Sensitivity (`sensitivity.csv`)

Spearman correlation with the headline ranking under equal weights, earnings-only, early-earnings-only, no graduation, no employment, and no cost-of-living adjustment. All are published with every run.

## 9. Known limitations

- Scorecard earnings cover federal aid recipients only; at wealthy schools that is a minority of students.
- 4-digit CIP codes can bundle specialties (for example, nurse anesthesia sits inside registered nursing).
- Majors dominated by students without federal aid (for example, many master's in computer science programs) have few published cells.
- State labor markets matter: California nursing graduates out-earn the national median even after cost of living, and that shows up in the table.
- Master's programs use the school's bachelor's graduate destinations for cost of living.

## Changes from v1.2

| v1.2 | v2.0 | Why |
|---|---|---|
| Earnings weighted by each school's actual major mix | Earnings compared with the same major nationally | Actual-mix rewarded schools for which majors they teach (e.g. University of Providence #55 → #939 once compared within major) |
| 30% "reputation" from yield, OpenAlex citations, retention/completion | Removed; graduation and employment scored directly as outcomes | Reputation is an input. OpenAlex name-matching also failed for 691 of 782 schools, which were silently set to the median |
| Per-major: bachelor's only, 50-completion floor, top 25, 66 majors | Bachelor's and master's, all published cells, partial pooling, top 250, 254 majors | The floor discarded most data and small programs were unshrunk |
| 4-year earnings only | 1-, 4- and 5-year horizons pooled | More coverage, less noise |
| "Grad-school feeder" flag from not-working counts | Removed | Those counts exclude enrolled students; the flag did not measure grad school |
| Branch campuses repeated parent earnings | Collapsed by OPEID6 | Double counting |
| Territories priced with a modeled mainland price level | Excluded with reason | No BEA price data; separate labor markets |
