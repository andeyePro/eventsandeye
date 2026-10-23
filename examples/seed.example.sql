-- Example event for Events&I. Copy, change every value, and apply after the migrations:
--   npx wrangler d1 execute <your-database> --remote --file seed/my-event.sql
-- Times are UTC (Europe/London is UTC from late October to late March, UTC+1 in summer).
-- After the first run, numbers, deadlines, times, locations and hosts are edited on the admin page (/admin/rsvps/),
-- so INSERT OR IGNORE keeps a rerun from overwriting those edits.

-- The event. in_person_max is the room's capacity; registration closes at deadline; travel_minutes sets the
-- "time to leave" calendar reminder; page_path is the page with the booking form; extra_question is optional.
INSERT OR IGNORE INTO events (id, title, starts_at, ends_at, timezone, location, in_person_max, deadline, travel_minutes, page_path, extra_question) VALUES
  ('2027-03-05-example', 'Example Community Day, Glasgow', '2027-03-05T10:00:00Z', '2027-03-05T21:00:00Z', 'Europe/London',
   'Example Hall, 1 Example Street, Glasgow', 30, '2027-02-26T23:59:00Z', 45, '/events/2027-03-05-example/',
   'Anything else you would like us to know?');

-- Sessions.
--   Core sessions (no choice_group) make up the day. mode: 'in_person', 'online' or 'hybrid' (remote attendees get
--   calendar entries for online and hybrid sessions).
--   Bookable options share the choice_group 'tour': people pick one, each has its own capacity and waiting list.
--   Opt-in sessions (optin = 1), such as a dinner, are ticked separately and can have a capacity and waiting list
--   too; people can also register for just these.
INSERT OR IGNORE INTO sessions (id, event_id, label, kind, mode, choice_group, starts_at, ends_at, capacity, sort, location, optin) VALUES
  ('2027-03-05-example-tour-1', '2027-03-05-example', '10:00 workshop tour', 'tour', 'in_person', 'tour', '2027-03-05T10:00:00Z', '2027-03-05T10:45:00Z', 8, 1, NULL, 0),
  ('2027-03-05-example-tour-2', '2027-03-05-example', '10:45 workshop tour', 'tour', 'in_person', 'tour', '2027-03-05T10:45:00Z', '2027-03-05T11:30:00Z', 8, 2, NULL, 0),
  ('2027-03-05-example-talks', '2027-03-05-example', 'Talks', 'talk', 'hybrid', NULL, '2027-03-05T11:30:00Z', '2027-03-05T16:00:00Z', NULL, 3, NULL, 0),
  ('2027-03-05-example-dinner', '2027-03-05-example', 'Dinner', 'social', 'in_person', NULL, '2027-03-05T17:30:00Z', '2027-03-05T20:30:00Z', 12, 4, 'The Example Arms, 2 Example Street, Glasgow', 1);

-- Joining instructions, version 1. Blocks between :::in-person, :::remote or :::extras (just the opt-in sessions)
-- and a closing ::: go only to those attendees; everything else goes to everyone. Later versions are added on the
-- admin page.
INSERT OR IGNORE INTO instructions (event_id, version, subject, body_md, change_note, created_at, created_by) VALUES
  ('2027-03-05-example', 1, 'Joining instructions: Example Community Day, 5 March 2027',
':::in-person
**Where:** Example Hall, 1 Example Street, Glasgow. Please sign in at reception.
:::

:::remote
**Joining remotely:** the talks are online from 11:30 to 16:00 (UK time). The link will be in your calendar entry.
:::

:::extras
**Dinner:** 17:30 at The Example Arms, 2 Example Street, Glasgow. Pay for your own on the night.
:::

To change or cancel your registration, use your personal link below.', 'First version', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'setup');
