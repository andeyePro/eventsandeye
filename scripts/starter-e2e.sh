#!/bin/sh
# Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
# Runs the end-to-end test from a throwaway copy of examples/starter, so it needs no host site:
#   sh scripts/starter-e2e.sh            (from the repository root; needs Node 22 and network access to npm)
# Set STARTER_DIR to keep the copy somewhere (it is reused, so later runs skip npm install).
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
dir=${STARTER_DIR:-$(mktemp -d)}
mkdir -p "$dir"
# The site's own files, refreshed on every run; node_modules is kept.
cp -R "$root/examples/starter/." "$dir/"
cp "$root/examples/wrangler.toml" "$dir/wrangler.toml"
rm -rf "$dir/functions" && cp -R "$root/examples/functions" "$dir/functions"
# eventsandeye/ is a copy, not a link: Pages Functions bundling and Astro both resolve it as a plain folder.
rm -rf "$dir/eventsandeye" && mkdir "$dir/eventsandeye"
(cd "$root" && tar cf - --exclude=./node_modules --exclude=./.git --exclude=./.vss --exclude=./examples/starter --exclude=./site .) | (cd "$dir/eventsandeye" && tar xf -)
cd "$dir"
[ -d node_modules ] || npm install --no-audit --no-fund
PUBLIC_TURNSTILE_ALLOW_TEST_KEY=true npx astro build
E2E_DB=events E2E_SEED=eventsandeye/examples/seed.example.sql E2E_NOTIFY=events@example.org \
	E2E_PAGES=/,/event/,/privacy/,/events/check-email/,/events/confirm/,/events/manage/ \
	node eventsandeye/tests/e2e.mjs
