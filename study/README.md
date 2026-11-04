# Rate study (PREREGISTERED.md, section 8)

This branch tests a discount rate linked to the 10-year Treasury yield (B, and the sensitivity rules S1 to S6)
against the fixed 8%, 9% and 10% (A) that the live site uses. Nothing here is live, and the live valuation does not
change unless the owner approves the comparison.

- `gs10.csv`: the 10-year Treasury yield, monthly averages (FRED, series GS10), saved once so every run uses the
  same data. A valuation on a month-end uses the month before's average, so nothing later is used.
- `lib/rates.js`: the rules. `tools/rate-study.mjs`: the 10-year job, run in six shards, valuing every month-end
  under every rule and the last month-end under the extreme yields. `tools/rate-compare.mjs`: the comparison and
  the six conditions of section 8.
- A run starts when `run.txt` changes; the results go to the `rate-study-results` branch (`report.json`, the
  five-year periods of each rule, and the raw shards).

## Details settled in the code before the first run (4 November 2026)

Section 8 decides; these only make its wording exact, and none was chosen after seeing a result.

- A is the published 10-year test, unchanged: run on the 10-year data of 3 November, the comparison gives A
  exactly that test's plan result (11.84% a year, worst fall 32.88%, the same 59 periods and shares), so B and the
  S rules differ from it only in the discount rate. The run itself fetches its data afresh, so its A can differ
  slightly from the published figures; A and B always share the same data.
- The five-year periods are the ones section 8 names: starting from December 2016 to October 2021, in two halves
  (to April 2019, and from May 2019). A period that would start later is not run.
- Condition 3 on the whole decade compares the worst fall on the 10-year path. Within each half (condition 4) it
  compares the deepest fall of any period starting in that half.
- A share (condition 2) or a fall (condition 3) that cannot be worked out counts as a fail, never a pass.
- The decisions are also shown for each half of the decade, split at December 2021 as in the 10-year test.
- Small yield moves: a month-to-month move of a quarter point or less. The report counts how often B's decision
  changed while A's stayed in those months, next to the same share in all months (if it is no higher, the changes
  come from prices meeting a different line, not from the yield). It also values today's companies a quarter point
  either side of October 2026's 5.13% and lists the decisions that change.
