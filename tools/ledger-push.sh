#!/usr/bin/env bash
# Adds this run's entry to the deploy log (the append-only "deploy-log" branch).
# Env: LEDGER_URL (git URL of the repository), PUSH (true only for runs on main), NEEDS_JSON and the run facts that
# tools/deploy-log.mjs compose reads. Never forces a push: if another run got there first it starts again from the new head.
# On any run that is not on main (PUSH != true) the entry is built and checked exactly the same, then NOT pushed.
set -euo pipefail
cd "$(dirname "$0")/.."
work="${LEDGER_WORK:-$(mktemp -d)}"
for attempt in 1 2 3 4 5; do
  rm -rf "$work/ledger" "$work/before"
  git clone -q --depth 1 --branch deploy-log "$LEDGER_URL" "$work/ledger"
  node tools/deploy-log.mjs verify "$work/ledger"
  cp -r "$work/ledger" "$work/before"
  node tools/deploy-log.mjs compose "$work/ledger"
  node tools/deploy-log.mjs verify "$work/ledger"
  node tools/deploy-log.mjs add-only "$work/before" "$work/ledger"
  if [ "${PUSH:-false}" != "true" ]; then
    echo "Not a run on main: the entry above was built and checked, and was not pushed."
    cat "$(ls "$work"/ledger/entries/*.json | tail -1)"
    exit 0
  fi
  git -C "$work/ledger" config user.name "github-actions[bot]"
  git -C "$work/ledger" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git -C "$work/ledger" add entries
  git -C "$work/ledger" commit -q -m "Deploy log: run ${RUN_ID:-?} $(git -C "$work/ledger" diff --cached --name-only | tail -1 | sed 's#entries/##')"
  if git -C "$work/ledger" push -q origin HEAD:deploy-log; then echo "Deploy log entry pushed."; exit 0; fi
  echo "Another run added an entry first (attempt $attempt); starting again from the new head."
  sleep $((attempt * 3))
done
echo "::error::Could not add this run to the deploy log."
exit 1
