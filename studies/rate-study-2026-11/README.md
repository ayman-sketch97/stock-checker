# Closed study: a discount rate linked to the 10-year Treasury yield (November 2026)

Kept here for good, whatever it showed (PREREGISTERED.md, sections 8 and 8.1).

- **Question:** would valuing companies at the 10-year Treasury yield plus 4, 5 or 6 points, instead of the fixed
  8%, 9% and 10%, have made better decisions on the same companies, prices and rules?
- **Design:** written down first in PREREGISTERED.md, section 8 (3 November 2026), with six conditions a change would
  have to meet and six sensitivity rules that could not be adopted on their own.
- **Result (run 1, 4 November 2026):** it failed all six conditions. It won 12 of 59 five-year periods against the
  fixed rates, beat random halal stocks in 29% of them (fixed rates 63%) and the S&P 500 in 24% (73%), and fell 5.7
  points deeper. None of the sensitivity rules met conditions 1 and 3. Details in `RESULTS.md`.
- **Decision (6 November 2026, the owner):** the research line is closed. The fixed 8%, 9% and 10% stay; no variant is
  adopted, the 6.5% floor included.

Files here: `RESULTS.md` (the write-up), `report.json` (the comparison's full output) and `gs10.csv` (the yields the
study used, FRED series GS10, saved on 4 November 2026). Elsewhere, unchanged since the run:

- the code that ran, on the `rate-study` branch (commit 60d29ee; the write-up added in 706f17c). It never reached the
  live site: `lib/engine.js` and the rest of the live code are untouched by it;
- the raw data (six shards of every month-end valued under every rule) and the five-year periods of each rule, under
  the tag `rate-study-run-1` (commit 51b704d on the `rate-study-results` branch).
