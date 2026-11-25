# School research files

One JSON file per school (`<slug>.json`). The schools are listed in `manifest.json`: the US News top 100 national universities and top 50 liberal arts colleges. Forge's onboarding research step reads a school's file first and only searches the web for what is missing or stale. The shape and validator are in `lib/school-research.ts`. Check a file with `node scripts/research/validate.mjs <slug>`.

Today's admissions cycle is **2026-27**: students apply in fall 2026 and winter 2027 to enter in fall 2027. Write `"cycle": "2026-27"` only when the source clearly describes that cycle. Otherwise write the cycle it describes, for example `"2025-26"`.

## Standards

1. **Never guess.** Every fact, deadline and prompt must be read from a page you fetched, and that page goes in `sourceUrl`. If you can't find something, leave it out and say what's missing in a `notes` fact. Don't fill it from memory.
2. **Use the best source:**
   - the school's own admissions, financial aid and institutional research pages
   - its latest Common Data Set (2025-26, or 2024-25 if newer isn't posted)
   - NCES College Navigator (nces.ed.gov/collegenavigator) for net price by income
   - anything else is a third-party source, marked `"thirdParty": true`
3. **Use current numbers.** The admit rate and middle-50% scores come from the latest CDS section C, and the value names the class or year, e.g. `"5.4% (Class of 2029, CDS 2025-26)"`. Prefer the current cycle's pages for deadlines, test policy and prompts.
4. **Copy essay prompts word for word**, with the word or character limit and whether they're required. Use the school's own pages first. Use a third-party page (marked `thirdParty`) only when the school doesn't publish prompts outside the Common App. If a school has no supplements, add a `notes` fact saying so, with a source.
5. **Deadlines** are ISO dates for every round offered (ED, ED2, EA, REA/SCEA, RD, Priority, Rolling). Put the round in `plan`, e.g. `"ED"`, `"ED2"`, `"EA"`, `"REA"`, `"RD"`. Add a `note` for things like "CSS Profile due" or "Restrictive".
6. **Keep values short and concrete**, like a counselor's notes. For example: `"Meets 100% of demonstrated need, no loans"`, `"Test-required (SAT/ACT) from Fall 2025 entry"`, `"$12,400"`, `"Optional alumni interview; not evaluative"`.
7. **No personal data.** Use no names of staff, no emails and no phone numbers.

## Facts to cover (`key`)

| key | what |
|---|---|
| `admit_rate` | overall admit rate, with the class/year |
| `ed_admit_rate` | the ED or early admit rate, if published |
| `sat_mid50`, `act_mid50` | middle 50% of enrolled students (CDS C9) |
| `gpa_note` | GPA or class-rank context (CDS C11/C12), if useful |
| `test_policy` | required, optional, blind, or superscore policy, for the current cycle |
| `meets_full_need` | yes/no, % of need met, no-loan policy |
| `css_profile` | whether the CSS Profile is required, with its deadline if stated |
| `merit_aid` | whether merit scholarships exist, and how to be considered |
| `net_price_lt30k` … `net_price_gt110k` | average net price by family income, from College Navigator (brackets: 0–30k, 30–48k, 48–75k, 75–110k, 110k+) |
| `sticker_cost` | total cost of attendance for the current year |
| `ed_ea_options` | which early rounds exist and their rules (binding, restrictive) |
| `interview` | whether interviews are offered, required or evaluative |
| `demonstrated_interest` | whether it's considered (CDS C7 "Level of applicant's interest") |
| `major_notes` | capped or competitive majors, direct admit to a school or college, programs needing separate applications |
| `notes` | anything else a counselor would flag, plus gaps |

Set `complete: true` only when every key above (except `ed_admit_rate`, `gpa_note` and `notes`) has a sourced fact, there's at least one deadline, and either the supplements are listed or a sourced note says there are none.
