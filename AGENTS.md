# Events&I – notes for agents (and humans)

Read this before changing anything. The longer versions are in [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md) and [TODO.md](TODO.md).

Events&I is registration for small community events on the organiser's own Cloudflare account: Pages Functions, a D1 database, a cron Worker, and email through Resend. It is not a standalone site. It lives as `eventsandeye/` inside the site that uses it (amybo.org is the reference: [amy-bo/website](https://github.com/amy-bo/website), live form at [amy.bo/event](https://amy.bo/event)), and that site's `functions/` wrappers call into `src/routes/`.

## Map

- `src/rsvp.ts`: the registration flows (register, confirm, change, cancel, promote, messages). `templates.ts`: every email's wording. `calendar.ts` and `ics.ts`: invitations and updates. `hosts.ts`: session host lists. `access.ts`: Cloudflare Access JWT checks.
- `src/routes/`: request handlers, called from the host site's `functions/` (copies of the wrappers are in `examples/functions/`).
- `migrations/`: the D1 schema. `worker/`: the cron Worker. `astro/`: the booking form, confirm and manage panels.
- `examples/`: config, function wrappers and a seed (AMYBO's event) for a new site. `site/`: events.andeye.com, a separate Astro build; it is not part of the product.
- `tests/e2e.mjs`: the end-to-end test, run from a host site against local D1. `tests/markdown.test.mjs`: unit tests (`node --test eventsandeye/tests/markdown.test.mjs`).

## Rules that will bite

- **Never edit a migration that has shipped.** Add the next numbered one; migrations only ever add.
- **Nothing emails attendees by surprise.** Every automatic email is listed in the README; anything new that emails people must be explicit and previewable on the admin page and recorded in the sent log. Editing a page or seeding the database must never email anyone.
- **Personal data is minimal and deleted.** No new personal fields without a purpose and a retention rule; registrations go 30 days after the event. No tracking, no third-party scripts.
- **No runtime dependencies** in `src/` and `worker/` beyond the Workers platform.
- **Every behaviour change gets a check in `tests/e2e.mjs`**, in the same commit.
- **Public repository.** No secrets, personal email addresses, local paths or machine names in commits. Host email addresses belong on the admin page, not in seeds.
- User-facing text is plain, short and in British English. Comments explain why, not what.
- Open work goes in [TODO.md](TODO.md).

## Licence

AGPL-3.0, with contributions under the andeye CLA ([CLA.md](CLA.md)); a bot asks each new contributor to sign on their first pull request. Keep the copyright header (`Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0`) on new source files.
