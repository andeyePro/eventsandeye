-- A worked example: AMYBO's event of Friday 13 November 2026, as its registration page shows it at https://amy.bo/event
-- (AMYBO's own seed, with its later updates, is at https://github.com/amy-bo/website/blob/main/seed/2026-11-13-london.sql).
-- Copy this file, change every value for your event, and apply it after the migrations:
--   npx wrangler d1 execute <your-database> --remote --file seed/my-event.sql
-- Times are UTC (Europe/London is UTC from late October to late March, UTC+1 in summer).
-- After the first run, numbers, deadlines, times, locations and hosts are edited on the admin page (/admin/rsvps/),
-- so INSERT OR IGNORE keeps a rerun from overwriting those edits.

-- The event. in_person_max is the room's capacity; registration closes at deadline; travel_minutes sets the
-- "time to leave" calendar reminder; page_path is the page with the booking form; extra_question is optional.
INSERT OR IGNORE INTO events (id, title, starts_at, ends_at, timezone, location, in_person_max, deadline, travel_minutes, page_path, extra_question) VALUES
  ('2026-11-13-london', 'AMYBO Event, London', '2026-11-13T10:30:00Z', '2026-11-13T22:00:00Z', 'Europe/London',
   'I-HUB, Imperial College White City campus, 84 Wood Lane, London W12 0BZ', 20, '2026-11-06T12:00:00Z', 60, '/events/2026-11-13-london/',
   'Staying on for Saturday 14 November? Tell us if you would like to do something together, and what you fancy.');

-- Sessions.
--   Core sessions (no choice_group) make up the day. mode: 'in_person', 'online' or 'hybrid' (remote attendees get
--   calendar entries for online and hybrid sessions).
--   Bookable options share the choice_group 'tour': people pick one, each has its own capacity and waiting list.
--   Opt-in sessions (optin = 1), such as a dinner, are ticked separately and can have a capacity and waiting list
--   too; people can also register for just these.
--   Hosts (who get the attendee list whenever it changes) are best set on the admin page, so their email addresses
--   stay out of your repository.
INSERT OR IGNORE INTO sessions (id, event_id, label, kind, mode, choice_group, starts_at, ends_at, capacity, sort, location, optin) VALUES
  ('2026-11-13-london-tour-1030', '2026-11-13-london', '10:30 lab tour', 'tour', 'in_person', 'tour', '2026-11-13T10:30:00Z', '2026-11-13T11:15:00Z', 10, 1, NULL, 0),
  ('2026-11-13-london-tour-1115', '2026-11-13-london', '11:15 lab tour', 'tour', 'in_person', 'tour', '2026-11-13T11:15:00Z', '2026-11-13T12:00:00Z', 10, 2, NULL, 0),
  ('2026-11-13-london-talks-am', '2026-11-13-london', 'Welcome and talks', 'talk', 'hybrid', NULL, '2026-11-13T12:00:00Z', '2026-11-13T13:30:00Z', NULL, 3, NULL, 0),
  ('2026-11-13-london-talks-pm', '2026-11-13-london', 'Talks and discussion', 'talk', 'hybrid', NULL, '2026-11-13T14:30:00Z', '2026-11-13T16:30:00Z', NULL, 4, NULL, 0),
  ('2026-11-13-london-pub', '2026-11-13-london', 'Dinner', 'social', 'in_person', NULL, '2026-11-13T17:30:00Z', '2026-11-13T20:30:00Z', 10, 5,
   'The Hawk''s Nest, Goldhawk Road, Shepherd''s Bush Market, London W12 8DF (pay on the night)', 1);

-- Joining instructions, version 1. Blocks between :::in-person, :::remote or :::extras (just the opt-in sessions)
-- and a closing ::: go only to those attendees; everything else goes to everyone. Later versions are added on the
-- admin page.
INSERT OR IGNORE INTO instructions (event_id, version, subject, body_md, change_note, created_at, created_by) VALUES
  ('2026-11-13-london', 1, 'Joining instructions: AMYBO Event, 13 November 2026',
':::in-person
**Where:** Room 516, the I-HUB, Imperial College White City campus, 84 Wood Lane, London W12 0BZ. Please sign in at reception, then come up to Room 516.

**Schedule (UK time):**

- 10:30 First optional lab tour
- 11:15 Second optional lab tour, and networking
- 12:00 Welcome and talks
- 13:30 Lunch
- 14:30 Talks and discussion
- 16:30 Close
- 17:30 Dinner at The Hawk''s Nest, for those who signed up

Closed shoes are needed in the labs.
:::

:::remote
**Joining remotely:** the talks are online from 12:00 to 13:30 and from 14:30 to 16:30 (UK time). The links will be in your calendar entries.
:::

:::extras
**Dinner:** 17:30 at The Hawk''s Nest, Goldhawk Road, Shepherd''s Bush Market, London W12 8DF. Pay for your own on the night.
:::

To change or cancel your registration, use your personal link below.', 'First version', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'setup');
