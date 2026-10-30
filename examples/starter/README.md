# Events&I starter site

A small Astro site with everything Events&I needs: the booking form (`/event/`), the check-your-email, confirm and manage pages, an events page, a 404 page, and a privacy notice to adapt. Use it as the start of a new site, or copy its pages into yours.

To start a new site from it:

```sh
git clone https://github.com/andeyePro/eventsandeye.git eventsandeye-source
cp -R eventsandeye-source/examples/starter my-events-site
cd my-events-site
git init
git submodule add https://github.com/andeyePro/eventsandeye.git eventsandeye
cp -R eventsandeye/examples/functions/. functions/
cp eventsandeye/examples/wrangler.toml wrangler.toml
mkdir -p workers/cron seed && cp eventsandeye/examples/cron/wrangler.toml workers/cron/
cp eventsandeye/examples/seed.example.sql seed/my-event.sql   # optional: or create the event on the admin page
npm install
```

(`eventsandeye-source` is only needed for the copy; delete it afterwards.) Then make it yours:

- `src/pages/event.astro`: the event id (from your seed or the admin page), your organisation and contact address. Give the event the page path `/event/`: emails link to it.
- `src/pages/events/confirm.astro`: your contact address.
- `src/pages/privacy.astro`: fill in the brackets.
- `src/layouts/Base.astro`: your own design.
- `astro.config.mjs`: `site`, your site's address.
- `wrangler.toml` and `workers/cron/wrangler.toml`: `name` (the site's is your Cloudflare Pages project's name), the settings and the database id (README steps 4, 5 and 10).
- `.env.production`: one line, `PUBLIC_TURNSTILE_SITE_KEY=<site key>` (README step 6), committed: the key is public. Until it exists, the live build fails on purpose.

Then follow the README's set-up from step 4. To try it on your computer (README, "Develop and test locally"): `npm run db:migrate:local`, then either `npm run db:seed:local` (after changing `seed/my-event.sql` to describe your event, with `page_path` `/event/`) or create the event on the admin page, then `npm run build:test` (which uses Cloudflare's test Turnstile key) and `npm run pages:dev`.

Events&I's own tests run against this site: `sh scripts/starter-e2e.sh` in the Events&I repository.
