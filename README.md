# Events&I

Free, open source event registration for small community events, running entirely on your own Cloudflare account: Cloudflare Pages Functions, a D1 database and a small cron Worker, with emails sent through [Resend](https://resend.com).

Website: [events.andeye.com](https://events.andeye.com). Made by [andeye Ltd](https://andeye.com). Licensed under the [GNU AGPL-3.0](LICENSE).

> **Early release.** Events&I is in use on [amybo.org](https://amybo.org/events/), which is also the reference integration ([source](https://github.com/amy-bo/website)). Feedback is very welcome: [open an issue](https://github.com/andeyePro/eventsandeye/issues) or [send a message](https://contact.andeye.com/?source=eventsandeye&subject=Events%26I%20feedback).

## Contents

- [What it does](#what-it-does)
- [What you need](#what-you-need)
- [Set it up](#set-it-up)
- [Run an event](#run-an-event)
- [Develop and test locally](#develop-and-test-locally)
- [Settings reference](#settings-reference)
- [Updating](#updating)
- [Roadmap](#roadmap)
- [Licence](#licence)

## What it does

- **Registration with double opt-in.** People register on your page and must click "Complete registration" in an email before their place is confirmed. Unconfirmed registrations hold a place for the shorter of 48 hours or a third of the time left before the deadline, and are then deleted. The organiser is told when half the hold has passed.
- **Places and waiting lists.** An editable in-person maximum and registration deadline; remote places are unlimited. Bookable options (such as lab tours) have their own capacities, waiting lists and booking deadlines (by default, until each one starts). Opt-in sessions (such as a dinner) can have a capacity and waiting list too, and people can register for just those. Freed places are never handed out automatically: an organiser clicks **Promote**, which sends the joining instructions.
- **Self-service.** Every email carries a personal, signed link to view, change or cancel a registration. Cancelling deletes the registration.
- **Calendar invitations.** Joining instructions come with iCalendar invitations (iTIP `REQUEST`, stable UIDs, sequence numbers, a Europe/London time zone). Remote attendees get one entry per online session with reminders a day, an hour and 10 minutes before. In-person attendees get one entry for their day, from their booked session or the first talk, with reminders a week and a day before, a "time to leave" reminder (travel time plus 15 minutes) and 15 minutes before; opt-in sessions get entries of their own. Each email also has Google, Outlook.com, Office 365 and Yahoo links and an `.ics` download. When an organiser changes a session, only people whose own entries change get an update; cancellations send `CANCEL`.
- **Session hosts.** Each session can have a host who is emailed the attendee list whenever it changes, with additions in bold and removals struck through. Hosts see each attendee's name and whether they have a place. Registrants can opt in to sharing their email address and affiliation with hosts.
- **Organiser emails.** Versioned joining instructions with sections for in-person, remote and opt-in-only attendees; messages to everyone or a filtered group (in person, remote, a session, people on an older instructions version) sent now or scheduled; a per-recipient delivery record; and a markdown "sent log" so an assistant can draft the next update without repeating what people already have. CSV export and a BCC list for sending from your own mailbox.
- **Only a few automatic emails:** confirm your email; a reminder with the joining instructions for anyone who registers twice; joining instructions on confirmation or promotion; calendar updates only when someone's entries change; cancellation confirmation; notifications to the organiser; host lists. Editing a page never emails anyone, and session changes can be saved without emailing anyone.
- **Security and privacy.** Admin pages and API behind Cloudflare Access with two-factor sign-in, with the Access token verified again in code. Turnstile and a honeypot on the form. Confirmation needs a button press (a `POST`), so email link scanners cannot confirm. Registrations, delivery records and host lists are deleted 30 days after the event.
- **A permanent "next event" link.** `/events/next` redirects to whichever event is next, so a short link can point there once and never change.

## What you need

- A **Cloudflare account** with your domain on it. Events&I uses Pages, Pages Functions, D1, Workers (for the cron job), Turnstile and Zero Trust Access; small events fit within the free plans.
- A **[Resend](https://resend.com) account**, with your domain verified for sending.
- A **static site deployed on Cloudflare Pages**. The ready-made form, confirm and manage panels are [Astro](https://astro.build) components; other sites can copy their markup and scripts.
- **Node.js 22** and `wrangler` (Cloudflare's command-line tool) on your computer.

## Set it up

These steps assume your site's repository is checked out locally and Events&I goes in a folder called `eventsandeye/` at its root.

1. **Add Events&I to your site.** Either as a git submodule, which makes updating easy:

   ```sh
   git submodule add https://github.com/andeyePro/eventsandeye.git eventsandeye
   ```

   or by copying this repository's files into `eventsandeye/`. Then add `wrangler` and the Workers types to your site: `npm install -D wrangler @cloudflare/workers-types`.

2. **Route the functions.** Pages Functions are file-based, so your site needs one-line wrapper files that point at Events&I's handlers. Copy them all in one go:

   ```sh
   cp -R eventsandeye/examples/functions/. functions/
   ```

   This gives you `api/rsvp/*` (the public form API), `api/admin/*` and `admin/rsvps/` (the admin page, both behind the Access check in `_middleware.ts`), `api/dev/*` (only answers when `DEV_MODE=true`) and `events/next`.

3. **Add the pages people see.** Your site needs:

   - **An event page** with the booking form:

     ```astro
     ---
     import RsvpForm from '../eventsandeye/astro/RsvpForm.astro';
     ---
     <RsvpForm event="2026-11-13-london" controller="AMYBO (andeye Ltd)" contactHref="mailto:hello@amybo.org" />
     ```

     This is AMYBO's form, live at [amy.bo/event](https://amy.bo/event). `event` is the event id from your seed (step 5) and `controller` is who is responsible for the data, named in the consent text. Set the build variable `PUBLIC_TURNSTILE_SITE_KEY` (step 6); the build fails without it, so a test key can never reach your live site.
   - **`/events/check-email/`**, where the form sends people after registering. Include `eventsandeye/astro/SentTo.astro` to show the address the email went to, and ask them to click "Complete registration" in it.
   - **`/events/confirm/`** with `<ConfirmPanel contactHref="…" />` and **`/events/manage/`** with `<ManagePanel />`, both from `eventsandeye/astro/`. Give these two pages a `noindex` robots tag.
   - **A privacy notice** (at `/privacy/` unless you set `PRIVACY_URL`) that covers registrations, session hosts and the 30-day retention.

4. **Configure.** Copy [`examples/wrangler.toml`](examples/wrangler.toml) to your site's root and replace every example value (see the [settings reference](#settings-reference)).

5. **Create the database and your event.**

   ```sh
   npx wrangler login
   npx wrangler d1 create events --jurisdiction eu   # omit --jurisdiction to let Cloudflare choose
   ```

   Put the printed `database_id` into `wrangler.toml`. Copy [`examples/seed.example.sql`](examples/seed.example.sql) to, say, `seed/my-event.sql`. It describes AMYBO's event of 13 November 2026 ([amy.bo/event](https://amy.bo/event)) as a worked example: change it to describe yours (its comments explain each part), then:

   ```sh
   npx wrangler d1 migrations apply events --remote
   npx wrangler d1 execute events --remote --file seed/my-event.sql
   ```

6. **Turnstile.** In the Cloudflare dashboard, Turnstile → Add widget for your domain (and your project's `pages.dev` address), managed mode. Put the **site key** in the Pages build variable `PUBLIC_TURNSTILE_SITE_KEY` and keep the **secret key** for step 8.

7. **Resend.** Add your domain in Resend, then add the DNS records it shows in Cloudflare DNS with the proxy **off** (DNS only), and click Verify. The records sit on subdomains, so your existing mail keeps working. Create an API key with **sending access** only.

8. **Secrets.** In the Pages project → Settings → Variables and secrets, add:

   | Secret | Value |
   | --- | --- |
   | `TOKEN_SECRET` | the output of `openssl rand -hex 32`. Keep it stable: changing it breaks every link already emailed. |
   | `RESEND_API_KEY` | the Resend key |
   | `TURNSTILE_SECRET_KEY` | the Turnstile secret key |

   Never set `DEV_MODE` on Cloudflare.

9. **Cloudflare Access with two-factor sign-in.** Zero Trust → Access → Applications → Add → Self-hosted. Add your domain's `/admin/*` and `/api/admin/*` paths as destinations (and the same on your `pages.dev` address and its preview subdomains). Add an *Allow* policy for your organisers' email addresses and require multi-factor authentication: Access's own MFA (an authenticator app or security key) or an identity provider that enforces it. The email one-time PIN alone is not a second factor. Set the session duration to 12 hours or less. Then copy the application's **Audience (AUD) tag** into `ACCESS_AUD` and your team domain into `ACCESS_TEAM_DOMAIN`, and list the organisers in `ADMIN_EMAILS`: the code admits only those addresses, whatever the Access policy allows, and refuses admin requests without a valid Access token even if the policy is misconfigured.

   If you use Cloudflare's per-application MFA (Authentication → MFA → Authenticator application), its tokens report only `onetimepin`, so set `ACCESS_MFA = "application"` and keep that setting on. Otherwise the code checks the token's sign-in methods itself and names them when it refuses; accept other method names with `ACCESS_MFA_METHODS`.

10. **The cron Worker.** It sends scheduled messages, warns about and deletes unconfirmed registrations, and applies the 30-day retention. Copy [`examples/cron/wrangler.toml`](examples/cron/wrangler.toml) to `workers/cron/wrangler.toml` in your site, fill it in to match, then:

    ```sh
    npx wrangler deploy --config workers/cron/wrangler.toml
    npx wrangler secret put TOKEN_SECRET --config workers/cron/wrangler.toml
    npx wrangler secret put RESEND_API_KEY --config workers/cron/wrangler.toml
    ```

11. **Deploy and try it.** Push your site so Pages builds it, then on the live or preview address: register with your own email, confirm, change and cancel, and open `/admin/rsvps/` to check it asks you to sign in. Check that a calendar invitation shows as an invitation in Gmail and Outlook before opening registration widely.

Preview deployments get the same Functions and database binding as production, so either turn previews off (Settings → Builds → Branch control) or deploy previews as static pages only, as [amybo.org's deploy workflow](https://github.com/amy-bo/website/blob/main/.github/workflows/deploy.yml) does.

## Run an event

Everything day to day happens on the admin page, `/admin/rsvps/`:

- **Numbers at a glance:** in-person places, waiting lists, remote attendees, each tour and opt-in session, and unconfirmed registrations.
- **Settings:** the in-person maximum, registration deadline and travel time. Raising a maximum does not move anyone off a waiting list by itself.
- **Sessions:** times, locations, online links, hosts, capacities and booking deadlines. **Save** sends calendar updates to the people whose entries change; **Save without emailing anyone** leaves calendars to catch up with each person's next email.
- **Registrations:** each person's choices, with **Promote** buttons for anyone waiting (a place, a tour or an opt-in session), **Promote all who fit** for the in-person list, and **Remove**. Removing someone who confirmed tells them, as if they had cancelled.
- **Joining instructions:** add a new version when the details change. It goes automatically to everyone who confirms or is promoted from then on. To send it to people already registered, send a message with "Include the latest joining instructions" ticked.
- **Messages:** to everyone or a filtered group, now or scheduled, with a preview and a recipient count first.
- **Export:** a CSV of registrations, a BCC list, and the sent log.

## Develop and test locally

Copy [`examples/dev.vars.example`](examples/dev.vars.example) to your site's root as `.dev.vars` (gitignored), fill in `TOKEN_SECRET`, then:

```sh
npx wrangler d1 migrations apply events --local
npx wrangler d1 execute events --local --file seed/my-event.sql
npm run build
npx wrangler pages dev ./dist --port 8788
```

Open http://localhost:8788. With `DEV_MODE=true`, emails (with their calendar attachments) are printed to the console and kept in a local outbox at `/api/dev/outbox` instead of being sent, and the admin page opens without Cloudflare Access.

**End-to-end test.** [`tests/e2e.mjs`](tests/e2e.mjs) runs the whole flow against a local D1 database with `wrangler pages dev`, using AMYBO's event as its example: registration, confirmation, waiting lists, promotion, calendar invitations and updates, host lists, scheduled messages, holds, deadlines, cancellation, retention and the Access checks. From your site, after building it with `PUBLIC_TURNSTILE_ALLOW_TEST_KEY=true`, with `ORG_NAME=AMYBO` in `.dev.vars`:

```sh
E2E_DB=events E2E_SEED=eventsandeye/examples/seed.example.sql E2E_NOTIFY=<your NOTIFY_EMAIL> node eventsandeye/tests/e2e.mjs
```

The comment at the top of the test lists every setting.

**Calendar caveat.** How an invitation is shown depends on the recipient's email app: Gmail, Outlook and Apple Mail usually show it as an invitation and add it to the calendar, but some apps only offer the file. The add-to-calendar links and `.ics` download cover the rest. Many calendar apps also apply their own reminder settings instead of the ones in the invitation.

## Settings reference

In `wrangler.toml` `[vars]` (the cron Worker needs the same, apart from the Access settings):

| Setting | What it is |
| --- | --- |
| `SITE_URL` | Your site's public address, used in email links. |
| `EMAIL_FROM` | Sender and calendar organiser, e.g. `Example Organisers <events@example.org>`, on a domain verified in Resend. |
| `NOTIFY_EMAIL` | Where organiser notifications go; also the reply-to address. |
| `ORG_NAME` | Your organisation's name in emails and calendar entries. |
| `ORG_FOOTER` | A line at the foot of every email, e.g. your legal name and company number. |
| `PRIVACY_URL` | Your privacy notice (default `/privacy/`). |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Your Cloudflare Access team domain and the application's AUD tag. |
| `ADMIN_EMAILS` | Comma-separated organiser addresses allowed on the admin page. |
| `ACCESS_MFA`, `ACCESS_MFA_METHODS` | How two-factor sign-in is checked (see step 9). |
| `ACCESS_MAX_AGE_HOURS` | Admin sign-ins older than this must be repeated (default 12). |
| `EVENTS_INDEX_PATH` | Where `/events/next` goes when no event is coming up (default `/events/`). |
| `EVENTSANDEYE_URL` | The "Registrations via Events&I" link in emails and the form (default: this repository). |

Secrets: `TOKEN_SECRET`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY` (step 8). Build variable: `PUBLIC_TURNSTILE_SITE_KEY` (step 6).

## Updating

Update the submodule (`git submodule update --remote eventsandeye`), then apply any new database migrations before deploying:

```sh
npx wrangler d1 migrations apply events --remote
```

Migrations only ever add; they never change one that has shipped. Redeploy the cron Worker too, so it runs the same code as the site.

## Roadmap

[Open an issue](https://github.com/andeyePro/eventsandeye/issues) if you need any of these, or something else:

- **Any programme shape:** parallel sessions and tracks as well as sequential ones, several optional choice groups, per-session registration for multi-day events.
- **An event set-up front end:** create events, sessions and joining instructions in the admin page instead of SQL.
- **Framework-neutral components:** plain HTML and JavaScript versions of the form, confirm and manage panels.
- **Events&I Plus:** a fully hosted version, so you do not need your own Cloudflare account.

See [TODO.md](TODO.md) for the full list.

## Licence

GNU Affero General Public License v3.0: see [LICENSE](LICENSE). If you run a modified version for others, the AGPL requires you to offer them its source. Contributions are made under the [andeye Contributor Licence Agreement](CLA.md): a bot asks you to sign it on your first pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).
