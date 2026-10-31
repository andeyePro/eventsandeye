# Events&I

Free, open source event registration for small community events, running entirely on your own Cloudflare account: Cloudflare Pages Functions, a D1 database and a small cron Worker, with emails sent through [Resend](https://resend.com).

Website: [events.andeye.com](https://events.andeye.com). Made by [andeye Ltd](https://andeye.com). Licensed under the [GNU AGPL-3.0](LICENSE).

> **Public beta** (version 0.3.0-beta). Events&I is in use on [amybo.org](https://amybo.org/events/), which is also the reference integration ([source](https://github.com/amy-bo/website)). Feedback is very welcome: [open an issue](https://github.com/andeyePro/eventsandeye/issues) or [send a message](https://contact.andeye.com/?source=eventsandeye&subject=Events%26I%20feedback). Security problems: see [SECURITY.md](SECURITY.md).

## Contents

- [What it does](#what-it-does)
- [What you need](#what-you-need)
- [Quick start](#quick-start)
- [Set it up](#set-it-up)
- [Run an event](#run-an-event)
- [Troubleshooting](#troubleshooting)
- [Develop and test locally](#develop-and-test-locally)
- [Settings reference](#settings-reference)
- [Updating](#updating)
- [Roadmap](#roadmap)
- [Licence](#licence)

## What it does

- **Registration with double opt-in.** People register on your page and must click "Complete registration" in an email before their place is confirmed. Unconfirmed registrations hold a place for the shorter of 48 hours or a third of the time left before the deadline, but at least 15 minutes, and are then deleted. The organiser is told when half the hold has passed. At most a quarter of the in-person places (at least 5) are held for unconfirmed registrations at once, so made-up sign-ups cannot fill an event; beyond that, people get a place when they confirm, if one is free then.
- **Places and waiting lists.** An editable in-person maximum and registration deadline; remote places are unlimited. Bookable options (such as lab tours) have their own capacities, waiting lists and booking deadlines (by default, until each one starts). Opt-in sessions (such as a dinner) can have a capacity and waiting list too, and people can register for just those. Freed places are never handed out automatically: an organiser clicks **Promote**, which sends the joining instructions.
- **Self-service.** Every email carries a personal, signed link to view, change or cancel a registration. Cancelling deletes the registration.
- **Calendar invitations.** Joining instructions come with iCalendar invitations (iTIP `REQUEST`, stable UIDs, sequence numbers, the event's own time zone with its VTIMEZONE). Remote attendees get one entry per online session with reminders a day, an hour and 10 minutes before. In-person attendees get one entry for their day (one per day for an event over several days), from their booked session or the first talk, with reminders a week and a day before, a "time to leave" reminder (travel time plus 15 minutes) and 15 minutes before; opt-in sessions get entries of their own. Each email also has Google, Outlook.com, Office 365 and Yahoo links and an `.ics` download. When an organiser changes a session, only people whose own entries change get an update; cancellations send `CANCEL`.
- **Session hosts.** Each session can have a host who is emailed the attendee list whenever it changes (or at most once per a gap the organiser sets), with additions in bold and removals struck through. Hosts see each attendee's name and whether they have a place. Registrants can opt in to sharing their email address and affiliation with hosts.
- **Organiser emails.** Versioned joining instructions with sections for in-person, remote and opt-in-only attendees; messages to everyone or a filtered group (in person, remote, a session, people on an older instructions version) sent now or scheduled; a per-recipient delivery record; and a markdown "sent log" so an assistant can draft the next update without repeating what people already have. CSV export and a BCC list for sending from your own mailbox.
- **Only a few automatic emails:** confirm your email; a note that a registration was deleted, after "I did not register"; a confirmation for anyone who confirms onto a waiting list; a reminder with the joining instructions for anyone who registers twice; joining instructions on confirmation or promotion; calendar updates only when someone's entries change; cancellation confirmation; notifications to the organiser (including each poll suggestion, and a confirmation when an organiser answers one by email); host lists, and a note asking a replaced host to delete theirs. Editing a page never emails anyone, and session changes can be saved without emailing attendees (hosts still get their updated lists).
- **Security and privacy.** Admin pages and API behind Cloudflare Access with two-factor sign-in, with the Access token verified again in code. Turnstile and a honeypot on the form. Confirmation needs a button press (a `POST`), so email link scanners cannot confirm. Registrations, delivery records, host lists, polls, poll answers and messages are deleted 30 days after the event, and joining instructions lose their author's address.
- **Polls.** Ask registrants something like "What shall we do on Saturday?": on the booking form (optionally) or their manage page each person puts the options in order, most wanted first, and moves a line under the ones they would join, so "skiing, then camping, then hiking, but football or rugby and I'll stay at home" is one answer. The admin page shows how many would join each option, how many would stay at home, first choices and who is in. Registrants can add an option of their own and rank it straight away; the organiser is emailed and replies "yes", "no" or "use <their wording>" to add it for everyone (or decides on the admin page). Joining instructions invite anyone who has not answered yet. Answers are deleted with the registration.
- **A permanent "next event" link.** `/events/next` redirects to whichever event is next, so a short link can point there once and never change.

## What you need

- A **Cloudflare account** with your domain on it. Events&I uses Pages, Pages Functions, D1, Workers (for the cron job), Turnstile and Zero Trust Access; small events fit within the free plans.
- A **[Resend](https://resend.com) account**, with your domain verified for sending.
- A **static site deployed on Cloudflare Pages** (static output: Astro's Cloudflare adapter, or any `_worker.js`, replaces the `functions/` folder Events&I runs from). The ready-made form, confirm and manage panels are [Astro](https://astro.build) components; [plain HTML versions](html/) suit other sites. No site yet? Start from the [starter site](examples/starter/).
- **Node.js 22** and `wrangler` (Cloudflare's command-line tool) on your computer.

## Quick start

For someone at home with Cloudflare: the numbered steps below say the same at length, with the reasons.

```sh
git submodule add https://github.com/andeyePro/eventsandeye.git eventsandeye   # in your site (or start from examples/starter)
cp -R eventsandeye/examples/functions/. functions/                                 # the API, admin page and /events/next
cp eventsandeye/examples/wrangler.toml .                                           # then fill it in
npm install -D wrangler @cloudflare/workers-types
npx wrangler login
npx wrangler d1 create events                    # put the database_id it prints into wrangler.toml, then:
npx wrangler d1 migrations apply events --remote
```

Then: add the form, check-email, confirm, manage and privacy pages (step 3); a Turnstile widget (6) and a Resend domain (7); the secrets `TOKEN_SECRET`, `RESEND_API_KEY` and `TURNSTILE_SECRET_KEY` (8); Cloudflare Access with two-factor sign-in on `/admin/*` and `/api/admin/*` (9); the cron Worker with the same settings and secrets (10). Deploy, create your event on the admin page, `/admin/rsvps/`, and work through its set-up check until it disappears.

## Set it up

These steps assume your site's repository is checked out locally and Events&I goes in a folder called `eventsandeye/` at its root. **Starting without a site?** Copy [`examples/starter/`](examples/starter/), a minimal Astro site with every page Events&I needs, to a new repository and follow its README.

1. **Add Events&I to your site.** Either as a git submodule, which makes updating easy:

   ```sh
   git submodule add https://github.com/andeyePro/eventsandeye.git eventsandeye
   ```

   or by copying this repository's files into `eventsandeye/`. Then add `wrangler` and the Workers types to your site: `npm install -D wrangler @cloudflare/workers-types`.

2. **Route the functions.** Pages Functions are file-based, so your site needs one-line wrapper files that point at Events&I's handlers. Copy them all in one go:

   ```sh
   cp -R eventsandeye/examples/functions/. functions/
   ```

   This gives you `api/rsvp/*` (the public form and poll API), `api/admin/*` and `admin/rsvps/` (the admin page, both behind the Access check in `_middleware.ts`), `api/dev/*` (only answers when `DEV_MODE=true`) and `events/next`.

3. **Add the pages people see.** Your site needs:

   - **An event page** with the booking form:

     ```astro
     ---
     import RsvpForm from '../../eventsandeye/astro/RsvpForm.astro';
     ---
     <RsvpForm
       event="2026-11-13-london"
       controller="AMYBO (andeye Ltd)"
       contactHref="mailto:hello@amybo.org"
     />
     ```

     The import path is relative to your page; this one is for `src/pages/event.astro`. This is AMYBO's form, live at [amy.bo/event](https://amy.bo/event). `event` is the event id from your seed (step 5) and `controller` is who is responsible for the data, named in the consent text. The wording for the two ways to attend and the tour choice comes from the event (`in_person_label`, `remote_label` and `tour_legend` in your seed), so the form and the manage page always agree; without it they say "In person", "Remotely (online sessions only)" and "Optional tour (in person only)". The props `inPersonLabel`, `remoteLabel` and `tourLegend` override it on a page that needs something different. `privacyHref` (default `/privacy/`) is the privacy notice link in the consent text, and `sourceUrl` the "Registrations via Events&I" link. The components are styled with [Starlight](https://starlight.astro.build)'s CSS variables, with plain fallbacks on other Astro sites; those follow the page's `color-scheme`, so a site with a dark mode should declare `color-scheme` to match what it paints (the starter's layout does). Set `PUBLIC_TURNSTILE_SITE_KEY` (step 6); the build fails without it, so a test key can never reach your live site.
   - **`/events/check-email/`**, where the form sends people after registering. Include `eventsandeye/astro/SentTo.astro` to show the address the email went to, and ask them to click "Complete registration" in it.
   - **`/events/confirm/`** with `<ConfirmPanel contactHref="…" />` and **`/events/manage/`** with `<ManagePanel />`, both from `eventsandeye/astro/`. These two addresses are fixed (emails link to them). Give them a `noindex` robots tag.
   - **A privacy notice** (at `/privacy/` unless you change the form's `privacyHref` and, for emails, `PRIVACY_URL`) that covers registrations, session hosts, poll answers and suggestions (a suggester's name goes to the organisers with it), the 30-day retention, and the services that handle the data for you: Cloudflare (hosting, the database and Turnstile) and Resend (email, a US company), and where your database is. The starter site's [privacy notice](examples/starter/src/pages/privacy.astro) is a template to adapt.

   Emails and `/events/next` link to the event's `page_path`, so set it to the page with the form.

   **Not using Astro?** [`html/`](html/) has the same three components as plain HTML, with the same markup and scripts: `rsvp-form.html`, `confirm-panel.html` and `manage-panel.html`, generated from the Astro ones, and `sent-to.html` for the check-your-email page. Paste each into its page and replace the capitalised placeholders (event id, organisation, contact link, Turnstile site key: Cloudflare's test key `1x00000000000000000000AA` for trying it locally), and the form's `/privacy/` link if your notice is elsewhere, escaping `&`, `<` and `"` in what you type (`A &amp; B Ltd`). Then run `npm install` and `node scripts/build-html.mjs` in `eventsandeye/`, and copy `html/rsvp-form.js`, `confirm-panel.js`, `manage-panel.js` and `events-and-i.css` to your site. Each fragment loads its script by a relative `src`, so either put the scripts beside the pages (with the pages' addresses ending in `/`) or change the `src` to an absolute path; link the stylesheet with `<link rel="stylesheet">`. In `wrangler.toml`, set `pages_build_output_dir` to the folder your site's pages are built into (or kept in), not `./dist`. Every rule in it sits under the fragments' `.eai` wrapper, so it leaves the rest of your site alone; restyle it freely (without Starlight's variables it uses plain fallbacks, so it looks a little different). The wording for attending comes from the event (step 5); to use your own on one page, edit the label's text and add `data-fixed="1"` to its `<span>`.

4. **Configure.** Copy [`examples/wrangler.toml`](examples/wrangler.toml) to your site's root (or merge it into the one you have) and fill in what you know; steps 5 and 9 supply the database id and the Access settings. See the [settings reference](#settings-reference). Once a Pages project has a `wrangler.toml`, Cloudflare takes its settings from that file rather than the dashboard ([Cloudflare's docs](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)), so put plain settings there; secrets stay in the dashboard (step 8). Add `.dev.vars` and `.wrangler/` to your `.gitignore`: they hold local secrets and test registrations.

   If your site is not on Cloudflare Pages yet, create the project now: in the Cloudflare dashboard, Workers & Pages → Create → Pages → connect your Git repository, with the build command `npm run build` and the output folder `dist` (for Astro). Give it the same name as `name` in `wrangler.toml`, and note its `*.pages.dev` address for steps 6 and 9. Its first build fails until the Turnstile site key is in place (step 6), which is expected.

5. **Create the database and your event.**

   ```sh
   npx wrangler login
   npx wrangler d1 create events --jurisdiction eu   # omit --jurisdiction to let Cloudflare choose
   ```

   Put the printed `database_id` into `wrangler.toml`. You can create your event on the admin page once it is running (Events → New event), or seed it: copy [`examples/seed.example.sql`](examples/seed.example.sql) to, say, `seed/my-event.sql`. It describes AMYBO's event of 13 November 2026 ([amy.bo/event](https://amy.bo/event)) as a worked example: change it to describe yours (its comments explain each part), then:

   ```sh
   npx wrangler d1 migrations apply events --remote
   npx wrangler d1 execute events --remote --file seed/my-event.sql
   ```

6. **Turnstile.** In the Cloudflare dashboard, Turnstile → Add widget for your domain (and your project's `pages.dev` address), managed mode. The **site key** is public: the simplest place for it is a committed `.env.production` file in your site with the line `PUBLIC_TURNSTILE_SITE_KEY=<site key>`, which Astro reads when it builds. Keep the **secret key** for step 8. The server accepts a token only if Turnstile solved it on the same host name the registration is posted to, so serve the form and its API from one address (not, say, a proxy in front of `*.pages.dev`).

7. **Resend.** Add your domain in Resend, then add the DNS records it shows in Cloudflare DNS with the proxy **off** (DNS only), and click Verify. The records sit on subdomains, so your existing mail keeps working. Create an API key with **sending access** only. If your domain has no DMARC record yet, add one (a TXT record at `_dmarc`, such as `v=DMARC1; p=none;`): Gmail and Yahoo expect it, and invitations from a domain without one land in spam more often.

8. **Secrets.** In the Pages project → Settings → Variables and secrets, add:

   | Secret | Value |
   | --- | --- |
   | `TOKEN_SECRET` | the output of `openssl rand -hex 32`. Keep it stable: changing it breaks every link already emailed. |
   | `RESEND_API_KEY` | the Resend key |
   | `TURNSTILE_SECRET_KEY` | the Turnstile secret key |

   Never set `DEV_MODE` on Cloudflare.

9. **Cloudflare Access with two-factor sign-in.** Zero Trust → Access → Applications → Add → Self-hosted. Add your domain's `/admin/*` and `/api/admin/*` paths as destinations (and the same on your `pages.dev` address and its preview subdomains). Add an *Allow* policy for your organisers' email addresses and require multi-factor authentication: Access's own MFA (an authenticator app or security key) or an identity provider that enforces it. The email one-time PIN alone is not a second factor. Set the session duration to 12 hours or less. Then copy the application's **Audience (AUD) tag** into `ACCESS_AUD` and your team domain (such as `example.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN`, and list the organisers in `ADMIN_EMAILS` (required): the code admits only those addresses, whatever the Access policy allows, and refuses admin requests without a valid Access token even if the policy is misconfigured.

   If you use Cloudflare's per-application MFA (Authentication → MFA → Authenticator application), its tokens report only `onetimepin`, so set `ACCESS_MFA = "application"` and keep that setting on. Otherwise the code checks the token's sign-in methods itself and names them when it refuses; accept other method names with `ACCESS_MFA_METHODS`.

10. **The cron Worker.** Every five minutes it sends scheduled messages and the rest of big ones, queued calendar updates and host lists held back by a gap, warns about and deletes unconfirmed registrations, and applies the 30-day retention. It also receives replies to poll suggestions if you set that up (step 12). Copy [`examples/cron/wrangler.toml`](examples/cron/wrangler.toml) to `workers/cron/wrangler.toml` in your site (`mkdir -p workers/cron && cp eventsandeye/examples/cron/wrangler.toml workers/cron/`) and fill it in: its own `name` (such as `my-site-cron`), and otherwise the **same** values as the site's (`SITE_URL`, `EMAIL_FROM` and the rest, and the same database). Give it the **same** `TOKEN_SECRET` as the site (paste the value from step 8; a new one would break every link in the emails the cron sends) and the Resend key, then deploy:

    ```sh
    npx wrangler secret put TOKEN_SECRET --config workers/cron/wrangler.toml
    npx wrangler secret put RESEND_API_KEY --config workers/cron/wrangler.toml
    npx wrangler deploy --config workers/cron/wrangler.toml
    ```

    The admin page's set-up check says if the cron has not run, or runs with a different `TOKEN_SECRET`, `SITE_URL` or Resend key.

11. **Deploy and try it.** First turn preview deployments off, or make them static only (see the note under step 12): previews get the live database and settings. Push your site so Pages builds it, then open `/admin/rsvps/`: it should ask you to sign in, and its set-up check should be empty (work through anything it lists). Create your event there if you did not seed it. Then register with your own email, confirm, change and cancel. Check that a calendar invitation shows as an invitation in Gmail and Outlook before opening registration widely. If something goes wrong, see [Troubleshooting](#troubleshooting).

12. **Optional: answer poll suggestions by email.** Without this, suggestions are decided on the admin page (the email about each one links there). To decide by replying, the cron Worker receives the replies through Cloudflare Email Routing:

    - In the Cloudflare dashboard, your domain → Email → Email Routing. Email Routing takes over the MX records of the domain or subdomain it is enabled on, so if your email is handled elsewhere (Google Workspace, Microsoft 365 and so on) enable it on a subdomain such as `reply.example.org`, never on the domain your mailboxes use.
    - Routing rules → Custom addresses: create an address such as `polls@reply.example.org` with the action **Send to a Worker**, choosing your cron Worker.
    - Set `POLL_REPLY_EMAIL` to that address in both `wrangler.toml` files, and redeploy the site and the cron Worker. Emails about suggestions then ask for replies there.

    A reply acts only if its From address is `NOTIFY_EMAIL` or one in `ADMIN_EMAILS` (set it for the cron Worker too) and it carries the suggestion's reference, which is signed with `TOKEN_SECRET` and only ever sent to you; anything else is refused. When Email Routing records a DMARC failure for the sender's domain (in its `Authentication-Results` header), the reply is refused. A From address is easy to forge, so the reference is the real safeguard: do not forward suggestion emails to anyone who should not decide them. Out-of-office replies are ignored. The answer is the first line of the reply: `yes`, `no`, or `use <your wording>`. Wording that matches an existing option merges the suggestion into it.

Preview deployments get the same Functions and database binding as production, so either turn previews off (Settings → Builds → Branch control) or deploy previews as static pages only, as [amybo.org's deploy workflow](https://github.com/amy-bo/website/blob/main/.github/workflows/deploy.yml) does.

## Troubleshooting

Logs: `npx wrangler pages deployment tail` for the site (choose the production deployment) and `npx wrangler tail --config workers/cron/wrangler.toml` for the cron Worker. Start with the admin page's set-up check.

| What you see | What to check |
| --- | --- |
| The form says "The spam check failed" | `TURNSTILE_SECRET_KEY` is the widget's secret key; the widget lists the address the form is on (including `*.pages.dev` if you use it); the form and its API are served from the same address. |
| The form says "Something went wrong" | The site's log. Most often Resend refused the email: the domain in `EMAIL_FROM` is not verified in Resend, or the key lacks sending access. |
| No email arrives | Resend's dashboard shows whether it was sent; look in spam; add a DMARC record (step 7). |
| The build fails asking for `PUBLIC_TURNSTILE_SITE_KEY` | Step 6: the site key goes in a committed `.env.production`. |
| The build fails saying `PUBLIC_TURNSTILE_ALLOW_TEST_KEY` is for local test builds only | Remove it from the Pages project's build settings and any committed `.env`: it is only for `npm run build:test` on your computer. |
| The build fails saying `PUBLIC_TURNSTILE_ALLOW_TEST_KEY` is for local test builds only, on a Pages preview set up with test keys | The check covers every Cloudflare Pages build. Previews should be static only or off (step 12's note); build test previews elsewhere. |
| Every registration fails with "The spam check failed" after a deploy | A test build (`build:test`) was deployed: it carries Turnstile's test key, which the live secret refuses. Deploy a normal build. |
| The admin page says "not signed in through Cloudflare Access (no Access token reached the site…)" | The Access application must cover this address and path: `/admin/*` and `/api/admin/*` on every address you use. |
| …"the Access token is for another Access application" | `ACCESS_AUD` must be that application's AUD tag. |
| …"if you did sign in, check ACCESS_TEAM_DOMAIN", "issued by another team", or "not set up yet" | `ACCESS_TEAM_DOMAIN` is your team's domain, such as `example.cloudflareaccess.com`, and `ACCESS_AUD` is set; the site's log names which. |
| …"two-factor sign-in required (this sign-in reported: …)" | Require MFA in the Access policy (step 9), or, with Cloudflare's per-application MFA, set `ACCESS_MFA = "application"`. |
| …"ADMIN_EMAILS is not set" or "… is not an admin" | List the organisers' addresses in `ADMIN_EMAILS`. |
| Links in emails go to the wrong address | `SITE_URL`, on the site and the cron Worker. |
| Links in scheduled messages or reminders say the link is invalid | The cron Worker's `TOKEN_SECRET` differs from the site's (the set-up check says so). |
| Big messages stay "sending" | The cron Worker finishes them: check it is deployed and its log shows `scheduled run` every five minutes. |

## Run an event

Everything day to day happens on the admin page, `/admin/rsvps/`:

- **Set-up check:** at the top, only when something needs putting right: settings missing or still at their example values, test keys on the live site, database migrations not applied, a cron Worker that has not run in the last 20 minutes, and a cron Worker whose `TOKEN_SECRET`, `SITE_URL`, `EMAIL_FROM` or Resend key differ from the site's (which would break the links in what it sends).

- **Events:** switch between events, edit one (title, venue, dates, time zone, the form's wording), create a new one, or clone this one to a new date (programme, latest joining instructions and polls' options; never people, hosts or answers). Sessions can be added there too, and deleted while nobody has booked them. None of this emails anyone.

- **Numbers at a glance:** in-person places, waiting lists, remote attendees, each tour and opt-in session, and unconfirmed registrations.
- **Settings:** the in-person maximum, registration deadline, travel time, and optionally a minimum gap between attendee lists to each session host (changes in between are gathered into the next list, sent by the cron Worker; within a day of a session every change goes at once). Raising a maximum does not move anyone off a waiting list by itself, and a new travel time emails nobody (calendars catch up with each person's next email).
- **Sessions:** times, locations, online links, hosts, capacities and booking deadlines (for tours and opt-in sessions; blank means their start). **Save** sends calendar updates to the people whose entries change; **Save without emailing attendees** leaves calendars to catch up with each person's next email; session hosts are still sent their changed lists.
- **Abuse limits, so nobody can use the forms to flood an address:** a confirmed address that registers again gets one reminder every ten minutes and three a day at most; an unconfirmed registration can be replaced three times, then the address is left alone until it confirms or the hold lapses; and a registrant whose own changes have triggered ten emails in an hour is asked to wait.
- **Registrations:** each person's choices, with **Promote** buttons for anyone waiting (a place, a tour or an opt-in session), **Promote all who fit** for the in-person list, and **Remove**. Removing someone who confirmed tells them, as if they had cancelled.
- **Joining instructions:** add a new version when the details change. It goes automatically to everyone who confirms or is promoted from then on. To send it to people already registered, send a message with "Include the latest joining instructions" ticked.
- **Messages:** to everyone or a filtered group, now or scheduled, with a preview and a recipient count first. A big message, or one with joining instructions, goes out in pieces over a few minutes (the cron Worker sends the rest), to keep each request within Cloudflare's free-plan limits; the same goes for calendar updates after a session change. A message that keeps failing stops after five tries and can be resumed from the admin page without anyone getting it twice; an address Resend refuses is set aside so everyone else still gets it.
- **Polls:** create a poll with its options, see how many would join each option and who, add, rename or remove options (a removed option leaves everyone's ranking), stop taking suggestions, and close the poll. Suggestions waiting for a decision are listed with **Add for everyone**, **Add in my words…** and **Don't add**. Nobody is emailed about any of this: tell registrants about a poll with a message, and suggesters see what became of their suggestion on their manage page.
- **Export:** a CSV of registrations, a BCC list, and the sent log.

## Develop and test locally

Copy [`examples/dev.vars.example`](examples/dev.vars.example) to your site's root as `.dev.vars` (gitignored), fill in `TOKEN_SECRET`, then:

```sh
npx wrangler d1 migrations apply events --local
npx wrangler d1 execute events --local --file seed/my-event.sql
PUBLIC_TURNSTILE_ALLOW_TEST_KEY=true npm run build
npx wrangler pages dev ./dist --port 8788
```

Open http://localhost:8788. The example seed describes an event on 13 November 2026 with registration closing on 6 November: after that, move its dates (or create an event on the admin page) to try the form. With `DEV_MODE=true`, emails (with their calendar attachments) are printed to the console and kept in a local outbox at `/api/dev/outbox` instead of being sent, and the admin page opens without Cloudflare Access. In the outbox, an address containing `fail-send` is refused as Resend would refuse it, and one containing `fail-500` fails as in an outage, for trying out how messages recover.

**End-to-end test.** `sh scripts/starter-e2e.sh`, from this repository, runs it on a throwaway copy of the [starter site](examples/starter/); it needs only Node 22 and access to npm. [`tests/e2e.mjs`](tests/e2e.mjs) runs the whole flow against a local D1 database with `wrangler pages dev`, against AMYBO's example seed: registration, confirmation, waiting lists, promotion, calendar invitations and updates, host lists, polls and suggestions (email replies go through `/api/dev/inbound`), scheduled messages, holds, deadlines, cancellation, retention and the Access checks. It writes its own `.dev.vars`, backing yours up and restoring it afterwards. From your site:

```sh
PUBLIC_TURNSTILE_ALLOW_TEST_KEY=true npm run build
E2E_DB=events E2E_SEED=eventsandeye/examples/seed.example.sql E2E_NOTIFY=<your NOTIFY_EMAIL> node eventsandeye/tests/e2e.mjs
```

It loads `/`, `/privacy/`, `/events/confirm/` and `/events/manage/` from your build; set `E2E_PAGES` to a comma-separated list if your site's pages differ. The comment at the top of the test lists every setting.

**Browser tests.** `sh scripts/browser-tests.sh` drives the booking form, the confirm and manage pages, the admin page and the plain HTML versions in headless Chromium, on a throwaway copy of the starter site: keyboard use, error messages, phones, dark mode, large text and an automated accessibility check (axe-core). Install the browser once with `npx playwright-core install chromium`, or set `CHROMIUM_PATH` to one you have.

**Calendar caveat.** How an invitation is shown depends on the recipient's email app: Gmail, Outlook and Apple Mail usually show it as an invitation and add it to the calendar, but some apps only offer the file. The add-to-calendar links and `.ics` download cover the rest. Many calendar apps also apply their own reminder settings instead of the ones in the invitation.

## Settings reference

In `wrangler.toml` `[vars]` (the cron Worker needs the same, apart from the Access settings; it needs `ADMIN_EMAILS` too if organisers answer poll suggestions by email):

| Setting | What it is |
| --- | --- |
| `SITE_URL` | Your site's public address, used in email links. |
| `EMAIL_FROM` | Sender and calendar organiser, e.g. `Example Organisers <events@example.org>`, on a domain verified in Resend. |
| `NOTIFY_EMAIL` | Where organiser notifications go; also the reply-to address. |
| `ORG_NAME` | Your organisation's name in emails and calendar entries. |
| `ORG_FOOTER` | A line at the foot of every email, e.g. your legal name and company number. |
| `PRIVACY_URL` | Your privacy notice, linked in emails (default `/privacy/`). The form uses its `privacyHref` prop. |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Your Cloudflare Access team domain and the application's AUD tag. |
| `ADMIN_EMAILS` | Required. Comma-separated organiser addresses allowed on the admin page. |
| `ACCESS_MFA`, `ACCESS_MFA_METHODS` | How two-factor sign-in is checked (see step 9). |
| `ACCESS_MAX_AGE_HOURS` | Admin sign-ins older than this must be repeated (default 12). |
| `EVENTS_INDEX_PATH` | Where `/events/next` goes when no event is coming up (default `/events/`). |
| `PAID_PLAN` | `"true"` on the Workers paid plan: messages with joining instructions go out in bigger pieces (30 instead of 3 per run). |
| `POLL_REPLY_EMAIL` | Optional. The address Email Routing sends to the cron Worker, used as the reply-to of emails about poll suggestions (step 12). |
| `EVENTSANDEYE_URL` | The "Registrations via Events&I" link in emails (default: this repository). The form uses its `sourceUrl` prop. |

Secrets: `TOKEN_SECRET`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY` (step 8). Turnstile's public site key: `PUBLIC_TURNSTILE_SITE_KEY`, at build time (step 6).

## Updating

Releases are tagged (`v0.3.0-beta` and so on), and [CHANGELOG.md](CHANGELOG.md) says what each needs: new migrations, function wrappers and settings. To move to a release, check out its tag in the submodule and commit that in your site:

```sh
git -C eventsandeye fetch --tags && git -C eventsandeye checkout v0.3.0-beta
git add eventsandeye
```

(`git submodule update --remote eventsandeye` follows `main` instead, with everything not yet released.) Then apply any new database migrations before deploying:

```sh
npx wrangler d1 migrations apply events --remote
```

Migrations only ever add; they never change one that has shipped. Redeploy the cron Worker too, so it runs the same code as the site; the admin page's set-up check says if the database is missing a migration or the cron Worker has not run since. The cron Worker matters more than it did: since migration 0009 it finishes big messages and queued calendar updates, so check it is deployed and running (its log shows a `scheduled run` line every five minutes).

New features can bring new function wrappers (polls added `functions/api/rsvp/poll.ts`, `functions/api/admin/polls.ts` and `functions/api/dev/inbound.ts`; event set-up added `functions/api/admin/events.ts`). Copy any you do not have yet, leaving your existing ones alone:

```sh
cp -Rn eventsandeye/examples/functions/. functions/
```

With the plain HTML components, run `node scripts/build-html.mjs` in `eventsandeye/` again after updating, copy the new `.js` and `.css` files, and compare your pages with the new `html/*.html`.

## Roadmap

[Open an issue](https://github.com/andeyePro/eventsandeye/issues) if you need any of these, or something else:

- **Any programme shape:** parallel sessions and tracks as well as sequential ones, several optional choice groups, per-session registration for multi-day events.
- **Events&I Plus:** a fully hosted version, so you do not need your own Cloudflare account.

See [TODO.md](TODO.md) for the full list.

## Licence

GNU Affero General Public License v3.0: see [LICENSE](LICENSE). If you run a modified version for others, the AGPL requires you to offer them its source. Contributions are made under the [andeye Contributor Licence Agreement](CLA.md): a bot asks you to sign it on your first pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).
