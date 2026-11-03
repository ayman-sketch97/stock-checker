#!/usr/bin/env bash
# Saves today's files of the permanent record (lib/records.js) to the "records" branch.
# Usage: tools/save-record.sh <record dir>   (pushes only when PUSH_URL is set)
# The record is append-only: if any existing file would change or disappear, nothing is saved and this fails.
set -euo pipefail
if [ ! -d "$1" ]; then echo "No record checked out tonight, so nothing to save."; exit 0; fi
cd "$1"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
if git diff --cached --quiet; then echo "No new record today."; exit 0; fi
if git diff --cached --name-status | grep -v '^A'; then
  echo "::error::Refusing to change or delete an existing record."
  git reset -q
  exit 1
fi
git commit -q -m "Record $(date -u +%Y-%m-%dT%H:%MZ)"
if [ -n "${PUSH_URL:-}" ]; then
  if ! git push -q "$PUSH_URL" HEAD:records; then
    echo "::error::Could not save today's record; the next run adds these changes."
    exit 1
  fi
fi
