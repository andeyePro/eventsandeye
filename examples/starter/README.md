# Events&I starter site

A small Astro site with everything Events&I needs: the booking form, the check-your-email, confirm and manage pages, a 404 page, and a privacy notice to adapt. Use it as the start of a new site, or copy its pages into yours.

To start a new site from it, copy this folder to a new repository and, in that repository:

```sh
git init
git submodule add https://github.com/andeyePro/eventsandeye.git eventsandeye
cp -R eventsandeye/examples/functions/. functions/
cp eventsandeye/examples/wrangler.toml wrangler.toml
npm install
```

Then follow the README's set-up from step 4. Change the event id, organisation and contact address in `src/pages/event.astro` and `src/pages/events/confirm.astro`, fill in the brackets in `src/pages/privacy.astro`, and replace `src/layouts/Base.astro` with your own design.

Events&I's own tests run against this site: `sh scripts/starter-e2e.sh` in the Events&I repository.
