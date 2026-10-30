# Security policy

Events&I handles people's names and email addresses, and its admin page can email everyone registered, so please report security problems privately, not in a public issue.

## Reporting a vulnerability

Use GitHub's private reporting: the repository's **Security** tab → **Report a vulnerability**. If that is not available to you, use [andeye's contact form](https://contact.andeye.com/?source=eventsandeye&subject=Events%26I%20security) and say it is a security report; we will reply with a private channel.

Please include what an attacker could do, the steps to reproduce it, and the version (`VERSION` in `src/env.ts`, also shown on the admin page). We aim to acknowledge reports within a week and to fix serious problems before anything is published about them. We are happy to credit you in the changelog.

## Supported versions

Events&I is in beta: fixes go into the latest release only. Update by following the README's "Updating" section.

## What is in scope

The code in this repository: the registration API and pages, the admin page and its Cloudflare Access checks, link tokens, emails and calendar files, the cron Worker and its inbound email handler. Misconfigurations that the README warns against (for example `DEV_MODE` on a live site, or an Access application that does not cover the admin paths) are not vulnerabilities in Events&I, but if the code could catch them, we would like to hear about it.

## Known limitations

- Anyone can register any address. The address must be confirmed before a registration counts, unconfirmed registrations hold at most a quarter of the in-person places, and repeat registrations of one address are limited, but someone who registers a person's address before they do can delay that person's own registration until the hold lapses.
- Manage and calendar links carry their token in the address, so they appear in Cloudflare's request logs.
