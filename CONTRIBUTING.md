# Contributing to Events&I

Thanks for looking. Agents and humans alike: [AGENTS.md](AGENTS.md) is the short orientation map. Events&I is small on purpose: registration for community events, on the organiser's own Cloudflare account, with as few emails and as little personal data as possible. That shapes what follows.

## The short version

- Open an issue before a large change, so nobody builds the same thing twice.
- Run the unit tests (`npm install`, then `npm test`) and the end-to-end test before you open a pull request. The end-to-end test needs no site of your own: `sh scripts/starter-e2e.sh` builds a throwaway copy of the starter site in `examples/starter/` around your working tree and runs it (set `STARTER_DIR` to keep the copy and skip `npm install` next time). If you change a component, the admin page or anything else people click, also run the browser tests: `npx playwright-core install chromium`, then `sh scripts/browser-tests.sh` (or name the files in `tests/browser/` to run only those). GitHub Actions runs all three on every pull request. To run it from a site that hosts Events&I instead, see the README.

- Add a check to `tests/e2e.mjs` for every behaviour you add or change.
- Sign the CLA when the bot asks on your first pull request, and add your name to `CONTRIBUTORS.md` in your own commit.
- Everything you contribute is released under AGPL-3.0 and, separately, licensed to andeye Ltd under `CLA.md`. Both are explained under **Licensing** below.

## What the project will and will not take

- **Privacy first.** No tracking, no third-party event platforms, no new personal data fields without a clear purpose and a retention rule. New automatic emails need a strong case: the list in the README is deliberately short.
- **No surprises for registrants.** Anything that emails attendees must be explicit in the admin page, previewable, and recorded in the sent log.
- **Plain dependencies.** The server code runs on Cloudflare Workers with no runtime dependencies beyond the platform; keep it that way unless there is a good reason.

## Working on the code

- `src/` – server logic (`rsvp.ts` flows, `calendar.ts` and `ics.ts` invitations, `hosts.ts` host lists, `templates.ts` emails) and `routes/` handlers.
- `migrations/` – D1 schema. Add a new numbered migration; never edit one that has shipped.
- `worker/` – the cron Worker. `astro/` – booking, confirm and manage components (each script in its own module, shared with the plain HTML versions in `html/`, which `scripts/build-html.mjs` generates: rerun it after changing a component's markup; `npm test` checks it is up to date). `examples/` – config, seed and function wrappers for a new site. `site/` – events.andeye.com, not used by host sites.
- Sending goes in pieces small enough for the Workers free plan (50 D1 queries a request) and is finished by the cron: keep new send paths within that, and test failures with the dev outbox's `fail-send` and `fail-500` addresses.
- Code comments explain why, not what. User-facing text is plain, short and in British English.

## Licensing — what you are agreeing to

Events&I is licensed under **AGPL-3.0**.

Contributions are additionally covered by the **andeye Contributor Licence
Agreement** (`CLA.md`, version 1.0). In plain terms: you keep your copyright,
your contribution stays available under AGPL-3.0 and that cannot be taken back,
and you additionally allow andeye Ltd to relicense it — which is what lets andeye offer the
code under other terms where the AGPL cannot reach, such as Events&I Plus, a hosted version. The numbered clauses in
`CLA.md` are what actually binds; the summary box at the top of that file is
friendly, not authoritative.

Please read `CLA.md` before you open a pull request. The CLA Assistant bot
checks every pull request: on your first, it asks you to sign by commenting

> I have read the CLA Document and I hereby sign the CLA

and records your signature in `signatures/version1/cla.json`. Pull requests
cannot be merged until the author has signed. Please also add your name to
`CONTRIBUTORS.md` in that first pull request.

