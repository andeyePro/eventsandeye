#!/bin/sh
# Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
# Runs the browser tests in tests/browser/ against a throwaway copy of the starter site:
#   npm install && npx playwright-core install chromium && sh scripts/browser-tests.sh
# CHROMIUM_PATH drives another Chromium instead; STARTER_DIR keeps the site copy, as for scripts/starter-e2e.sh.
# Name test files to run only those: sh scripts/browser-tests.sh tests/browser/manage.mjs
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
if [ -n "${STARTER_DIR:-}" ]; then
	dir=$STARTER_DIR
else
	dir=$(mktemp -d)
	trap 'rm -rf "$dir"' EXIT
fi
STARTER_DIR=$dir STARTER_SKIP_E2E=1 sh "$root/scripts/starter-e2e.sh"
cd "$root"
[ $# -gt 0 ] || set -- $(ls tests/browser/*.mjs | grep -v '/harness\.mjs$')
failed=''
for f in "$@"; do
	echo "== $f"
	SITE_DIR=$dir node "$f" || failed="$failed $f"
done
[ -z "$failed" ] || { echo "Failed:$failed" >&2; exit 1; }
