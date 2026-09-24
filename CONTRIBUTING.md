# Contributing to Events&I

Thanks for looking. Events&I is small on purpose: registration for community events, on the organiser's own Cloudflare account, with as few emails and as little personal data as possible. That shapes what follows.

## The short version

- Open an issue before a large change, so nobody builds the same thing twice.
- Run the end-to-end test before you open a pull request: from the site that hosts Events&I, `npm run build && npm run test:e2e` (see `tests/e2e.mjs`).
- Add a check to `tests/e2e.mjs` for every behaviour you add or change.
- Add your name to `CONTRIBUTORS.md` in your first pull request, in your own commit.
- Everything you contribute is released under AGPL-3.0 and, separately, licensed to andeye Ltd under `CLA.md`. Both are explained under **Licensing** below.

## What the project will and will not take

- **Privacy first.** No tracking, no third-party event platforms, no new personal data fields without a clear purpose and a retention rule. New automatic emails need a strong case: the list in the README is deliberately short.
- **No surprises for registrants.** Anything that emails attendees must be explicit in the admin page, previewable, and recorded in the sent log.
- **Plain dependencies.** The server code runs on Cloudflare Workers with no runtime dependencies beyond the platform; keep it that way unless there is a good reason.

## Working on the code

- `src/` – server logic (`rsvp.ts` flows, `calendar.ts` and `ics.ts` invitations, `hosts.ts` host lists, `templates.ts` emails) and `routes/` handlers.
- `migrations/` – D1 schema. Add a new numbered migration; never edit one that has shipped.
- `worker/` – the cron Worker. `astro/` – booking, confirm and manage components.
- Code comments explain why, not what. User-facing text is plain, short and in British English.

## Licensing — what you are agreeing to

Events&I is licensed under **AGPL-3.0**.

Contributions are additionally covered by the **andeye Contributor Licence
Agreement** (`CLA.md`, version 1.0). In plain terms: you keep your copyright,
your contribution stays available under AGPL-3.0 and that cannot be taken back,
and you additionally allow andeye Ltd to relicense it — which is what lets andeye offer a hosted
Events&I Plus and other terms where the AGPL cannot reach. The numbered clauses in
`CLA.md` are what actually binds; the summary box at the top of that file is
friendly, not authoritative.

To agree, add your name to `CONTRIBUTORS.md` in your first pull request, or say
so in the pull request description. Please read `CLA.md` before you do.

