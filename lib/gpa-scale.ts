/**
 * High schools grade on different scales (4.0, 4.33 with A+ above 4.0, 100-point, 5.0 or 6.0
 * weighted), but Forge compares GPAs with colleges' reported averages on a 4.0 unweighted scale.
 * The onboarding interview and the hub copilot both follow these rules before saving a GPA.
 */
export const GPA_SCALE_RULES = `Grading scales: before saving any GPA, check the high school's grading scale (the transcript's grade legend or the school profile shows it; otherwise ask, e.g. single tiles "4.0", "4.33 (A+ counts above 4.0)", "100-point", "Something else"). Save it as gpaScale with set_applicant_snapshot. gpaUnweighted, gpaRecent and gpaByYear are always 4.0 unweighted, so convert first:
- Letter grades with an A+ above 4.0 (a 4.33 or 4.3 scale): recompute from the transcript's grades with A+ and A = 4.0, A- = 3.7, B+ = 3.3, B = 3.0, B- = 2.7, C+ = 2.3, C = 2.0, C- = 1.7, D = 1.0, F = 0, which is how colleges recalculate.
- A 100-point scale: use the conversion printed on the transcript or school profile; without one, 93-100 = 4.0, 90-92 = 3.7, 87-89 = 3.3, 83-86 = 3.0, 80-82 = 2.7, 77-79 = 2.3, 73-76 = 2.0, 70-72 = 1.7, 65-69 = 1.0, below 65 = 0, averaged over courses.
- Never scale proportionally (3.9 / 4.33 × 4 is wrong). With only an overall number and no grades, save your best 4.0 estimate, tell the student it's an estimate, and ask for the transcript.
- A weighted GPA stays as the school reports it (on its own scale, up to 6), with the scale in gpaScale.
- A number that doesn't fit its scale (an "unweighted" 4.2, a "GPA" of 92) means the scale is wrong: ask before saving.
- Ask about the scale and the weighted GPA once each. Whatever they answer, including "not sure", a skip or the same number as their unweighted GPA, is final: save it (a weighted GPA equal to the unweighted one is fine) and move on. Never re-ask or re-confirm a GPA they already answered, and don't repeat the estimate explanation; say it once.`;
