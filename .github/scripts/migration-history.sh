#!/usr/bin/env bash
# A migration that has reached main may have run on the server, so it is never
# edited, renamed or removed, and a new one must sort after all of them.
#   .github/scripts/migration-history.sh <base commit>
set -euo pipefail
base="${1:?base commit}"
folder=apps/api/prisma/migrations

# Snapshots may be rewritten; check-migrations.cjs proves they are right.
changed="$(git diff --no-renames --name-only --diff-filter=MD "$base" HEAD -- "$folder" |
  grep -v '/schema\.snapshot$' || true)"
if [ -n "$changed" ]; then
  echo "These released migration files were changed or removed. Add a new migration instead:" >&2
  echo "$changed" >&2
  exit 1
fi

names() { git ls-tree -d --name-only "$1" -- "$folder/" | sed "s|.*/||"; }
latest="$(names "$base" | LC_ALL=C sort | tail -1)"
for name in $(LC_ALL=C comm -13 <(names "$base" | LC_ALL=C sort) <(names HEAD | LC_ALL=C sort)); do
  if [[ -n "$latest" && ! "$name" > "$latest" ]]; then
    echo "$name must sort after $latest. Rename it with a newer timestamp." >&2
    exit 1
  fi
done
