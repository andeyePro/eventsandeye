#!/bin/sh
# Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
# Runs the end-to-end test from a throwaway copy of examples/starter, so it needs no host site:
#   sh scripts/starter-e2e.sh            (from the repository root; needs Node 22 and network access to npm)
# STARTER_SKIP_E2E=1 only builds the copy (scripts/browser-tests.sh uses that).
# Set STARTER_DIR to keep the copy somewhere outside the repository (it is reused, so later runs skip npm install
# until the starter's package.json changes).
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
if [ -n "${STARTER_DIR:-}" ]; then
	mkdir -p "$STARTER_DIR"
	dir=$(cd "$STARTER_DIR" && pwd)
	case "$dir/" in "$root/"*) echo "STARTER_DIR must be outside the repository (it is copied into the starter)" >&2; exit 1 ;; esac
else
	dir=$(mktemp -d)
	trap 'rm -rf "$dir"' EXIT
fi
# The site's own files, refreshed on every run; node_modules is kept while package.json is unchanged.
if ! cmp -s "$root/examples/starter/package.json" "$dir/package.json"; then rm -rf "$dir/node_modules"; fi
cp -R "$root/examples/starter/." "$dir/"
cp "$root/examples/wrangler.toml" "$dir/wrangler.toml"
rm -rf "$dir/functions" && cp -R "$root/examples/functions" "$dir/functions"
# eventsandeye/ is a copy, not a link: Pages Functions bundling and Astro both resolve it as a plain folder.
rm -rf "$dir/eventsandeye" && mkdir "$dir/eventsandeye"
(cd "$root" && tar cf - --exclude=./node_modules --exclude=./.git --exclude=./.vss --exclude=./examples/starter --exclude=./site .) | (cd "$dir/eventsandeye" && tar xf -)
# The example seed's event lives at /events/2026-11-13-london/ on amybo.org; on the starter its form is /event/.
sed 's#/events/2026-11-13-london/#/event/#' "$root/examples/seed.example.sql" > "$dir/eventsandeye/examples/seed.example.sql"
cd "$dir"
[ -d node_modules ] || npm install --no-audit --no-fund
# A test build on Cloudflare Pages must fail: it would ship a Turnstile key the live server refuses.
if CF_PAGES=1 PUBLIC_TURNSTILE_ALLOW_TEST_KEY=true npx astro build >/dev/null 2>&1; then echo "a test build on Cloudflare Pages should have failed" >&2; exit 1; fi
PUBLIC_TURNSTILE_ALLOW_TEST_KEY=true npx astro build
[ "${STARTER_SKIP_E2E:-}" = 1 ] && exit 0
E2E_DB=events E2E_SEED=eventsandeye/examples/seed.example.sql E2E_NOTIFY=events@example.org \
	E2E_PAGES=/,/event/,/events/,/privacy/,/events/check-email/,/events/confirm/,/events/manage/ \
	node eventsandeye/tests/e2e.mjs
