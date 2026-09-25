# Events&I

Free, open source event registration for small community events, running entirely on your own Cloudflare account: Cloudflare Pages Functions, a D1 database and a small cron Worker, with emails sent through [Resend](https://resend.com).

> **Beta.** Events&I is in use for the first time for the [AMYBO get-together on 13 November 2026](https://amybo.org/events/2026-11-13-london/). It stays in beta until it has been through that event. All feedback is hugely welcome: [open an issue](https://github.com/andeyePro/eventsandeye/issues) or [send a message](https://contact.andeye.com/?source=eventsandeye&subject=Events%26I%20feedback).

Made by [andeye Ltd](https://andeye.com). Licensed under the [GNU AGPL-3.0](LICENSE); contributions under the [andeye CLA](CLA.md).

## What it does

- **Registration with double opt-in.** People register on your page and must click "Complete registration" in an email before their place is confirmed. Unconfirmed registrations hold a place for the shorter of 48 hours or a third of the time left before the deadline, and are then deleted. The organiser is told when half the hold has passed.
- **Places and waiting lists.** An editable in-person maximum and registration deadline; remote places are unlimited. Optional sessions (such as lab tours) have their own capacities, waiting lists and booking deadlines (by default, until each one starts). Freed places are never handed out automatically: an admin clicks **Promote**, which sends the joining instructions.
- **Self-service.** Every email carries a personal, signed link to view, change or cancel a registration. Cancelling deletes the registration.
- **Calendar invitations.** Joining instructions come with iCalendar invitations (iTIP `REQUEST`, stable UIDs, sequence numbers, a Europe/London time zone). Remote attendees get one entry per online session with reminders a day, an hour and 10 minutes before. In-person attendees get one entry for their day, from their booked session or the first talk, with reminders a week and a day before, a "time to leave" reminder (travel time plus 15 minutes) and 15 minutes before. Each email also has Google, Outlook.com, Office 365 and Yahoo links and an `.ics` download. When an organiser changes a session, only people whose own entries change get an update; cancellations send `CANCEL`.
- **Session hosts.** Each session can have a host who is emailed the attendee list whenever it changes, with additions in bold and removals struck through. Registrants can opt in to sharing their email address with hosts; otherwise hosts see names only.
- **Organiser emails.** Versioned joining instructions, messages to everyone or a filtered group (in person, remote, a session, people on an older instructions version) sent now or scheduled, a per-recipient delivery record, and a markdown "sent log" so an assistant such as Claude can draft the next update without repeating what people already have. CSV export and a BCC list for sending from your own mailbox.
- **Only a few automatic emails:** confirm your email; a reminder with the joining instructions for anyone who registers twice; joining instructions on confirmation or promotion; calendar updates only when someone's entries change; cancellation confirmation; notifications to the organiser; host lists. Editing a page never emails anyone.
- **Security and privacy.** Admin pages and API behind Cloudflare Access, with the Access JWT verified again in code. Turnstile and a honeypot on the form. Confirmation needs a button press (a `POST`), so email link scanners cannot confirm. Registrations, delivery records and host lists are deleted 30 days after the event.

## Using it now

Events&I is developed at [andeyePro/eventsandeye](https://github.com/andeyePro/eventsandeye); the [amybo.org website](https://github.com/amy-bo/website) carries a copy in `eventsandeye/` and is the reference integration. To add it to your own Cloudflare Pages site:

1. **Copy or submodule** this folder into your site's repository as `eventsandeye/`.
2. **Route the functions.** Pages Functions are file-based, so create one-line wrappers in your site's `functions/` folder, exactly as [amybo.org does](https://github.com/amy-bo/website/tree/main/functions), for example:

   ```ts
   // functions/api/rsvp/register.ts
   export { onRequestPost } from '../../../eventsandeye/src/routes/rsvp/register';
   ```

   You need `api/rsvp/{status,register,confirm,manage,calendar}`, `api/admin/*` with its `_middleware`, `admin/_middleware` and `admin/rsvps/index` (the admin page). `api/dev/*` is optional and only answers when `DEV_MODE=true`.
3. **Pages for people.** Your site needs a page with the booking form, and pages at `/events/confirm/` and `/events/manage/`. Astro sites can use the components in [`astro/`](astro/) (`RsvpForm`, `ConfirmPanel`, `ManagePanel`); other sites can copy their markup and scripts.
4. **Database.** Create a D1 database, point `migrations_dir` at `eventsandeye/migrations` in your `wrangler.toml`, apply the migrations, then insert your event, sessions and first joining instructions. [`examples/seed.example.sql`](examples/seed.example.sql) is a template; the amybo.org [seed](https://github.com/amy-bo/website/blob/main/seed/2026-11-13-london.sql) is a real one.
5. **Settings** in `wrangler.toml` `[vars]`: `SITE_URL`, `EMAIL_FROM`, `NOTIFY_EMAIL`, `ORG_NAME`, `ORG_FOOTER`, `PRIVACY_URL`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`. Secrets: `TOKEN_SECRET` (`openssl rand -hex 32`, keep it stable), `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`.
6. **Cron Worker.** Deploy [`worker/index.ts`](worker/index.ts) with a cron trigger every five minutes and the same D1 binding and secrets (see amybo.org's `workers/cron/wrangler.toml`).
7. **Cloudflare Access** on `/admin/*` and `/api/admin/*`, and a privacy notice that covers registrations, session hosts and retention.

The amybo.org [README](https://github.com/amy-bo/website#setting-up-cloudflare-first-deploy) walks through the Cloudflare, Resend DNS and Access steps click by click.

**Testing.** [`tests/e2e.mjs`](tests/e2e.mjs) runs the whole flow against a local D1 database with `wrangler pages dev`, with emails captured in a dev outbox: registration, confirmation, waiting lists, promotion, calendar invitations and updates, host lists, scheduled messages, holds, deadlines, cancellation, retention and the Access checks. Point it at your seed with the `E2E_*` variables described at the top of the file.

**Calendar caveat.** How an invitation is shown depends on the recipient's email app: Gmail, Outlook and Apple Mail usually show it as an invitation and add it to the calendar, but some apps only offer the file. The add-to-calendar links and `.ics` download cover the rest. Many calendar apps also apply their own reminder settings instead of the ones in the invitation.

## Coming soon – contact us if you need it sooner

[Send a message](https://contact.andeye.com/?source=eventsandeye&subject=Events%26I%20request) or [open an issue](https://github.com/andeyePro/eventsandeye/issues) if you need any of these before they arrive:

- **Any programme shape:** parallel sessions and tracks as well as sequential ones, several optional choice groups, per-session registration for multi-day events.
- **An event set-up front end:** create events, sessions and joining instructions in the admin page instead of SQL.
- **Events&I Plus:** a fully hosted version, so you do not need your own Cloudflare account.

See [TODO.md](TODO.md) for the full list.

## Licence

GNU Affero General Public License v3.0 – see [LICENSE](LICENSE). If you run a modified version for others, the AGPL requires you to offer them its source. Contributions are made under the [andeye Contributor Licence Agreement](CLA.md); see [CONTRIBUTING.md](CONTRIBUTING.md).
