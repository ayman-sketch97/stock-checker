# Deploy log

An append-only record of every run of the stock-checker update pipeline: the analysis commit, the build, the record files written
(with hashes), each check, the deployment, the live check, any rollback, and the restore points made.

- One file per run in `entries/`. Each entry carries the hash of the entry before it, so any later edit breaks the chain
  (`node tools/deploy-log.mjs verify <this folder>` checks it).
- The `status` field keeps two facts apart: whether the night's recommendations were **recorded** (the `records` branch) and whether
  the site was **deployed and checked live**. The four values are `recorded_and_deployed`, `recorded_not_deployed`,
  `not_recorded_deployed` and `neither`.
- Only runs on main add entries, and only by adding files. Nothing here is ever edited, removed or force-pushed.
- It never touches the `records` branch or the performance figures.
