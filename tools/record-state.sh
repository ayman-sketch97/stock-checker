#!/usr/bin/env bash
# Says what happened to the permanent record in this run, for the deploy log. Reads only.
# Usage: tools/record-state.sh <record dir> <head before> <is main: true|false> <save step outcome>
# Prints key=value lines: record_state (saved | already_saved | failed | unavailable | not_run),
# record_before, record_after, record_files (JSON: [{path, sha256}] of files added by this run).
set -euo pipefail
dir="$1"; before="$2"; is_main="$3"; outcome="$4"
after=none
if [ -d "$dir/.git" ]; then after=$(git -C "$dir" rev-parse HEAD 2>/dev/null || echo none); fi
if [ "$is_main" != "true" ]; then state=not_run
elif [ "$outcome" = "failure" ]; then state=failed
elif [ ! -d "$dir/.git" ]; then state=unavailable
elif [ "$after" != "$before" ]; then state=saved
else state=already_saved
fi
files='[]'
if [ "$state" = saved ]; then
  if [ "$before" = none ]; then names=$(git -C "$dir" diff-tree --root --no-commit-id --name-only -r "$after")
  else names=$(git -C "$dir" diff --name-only --diff-filter=A "$before" "$after"); fi
  files=$(while IFS= read -r p; do [ -n "$p" ] && printf '%s\t%s\n' "$p" "$(git -C "$dir" show "$after:$p" | sha256sum | cut -d' ' -f1)"; done <<< "$names" \
    | node -e "const l=require('fs').readFileSync(0,'utf8').split('\n').filter(Boolean).map(x=>x.split('\t'));console.log(JSON.stringify(l.map(([path,sha256])=>({path,sha256}))))")
fi
echo "record_state=$state"
echo "record_before=$before"
echo "record_after=$after"
echo "record_files=$files"
