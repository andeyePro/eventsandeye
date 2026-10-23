-- The event tests/e2e.mjs runs against: a fictional day with every feature in use (two lab tours with their own
-- capacities, hybrid talks, a dinner people opt in to with a capacity of its own, and joining instructions with
-- in-person, remote and dinner-only sections). Wednesday 13 November 2030; Europe/London is UTC in November.
-- Every name, place and address here is made up.

INSERT OR IGNORE INTO events (id, title, starts_at, ends_at, timezone, location, in_person_max, deadline, travel_minutes, page_path, extra_question) VALUES
  ('2030-11-13-example', 'Example Community Day, Glasgow', '2030-11-13T10:30:00Z', '2030-11-13T22:00:00Z', 'Europe/London',
   'Example Hall, 1 Example Street, Glasgow', 20, '2030-11-06T12:00:00Z', 60, '/events/2030-11-13-example/',
   'Staying on for the weekend? Tell us if you would like to do something together.');

INSERT OR IGNORE INTO sessions (id, event_id, label, kind, mode, choice_group, starts_at, ends_at, capacity, sort, location, optin) VALUES
  ('2030-11-13-example-tour-1030', '2030-11-13-example', '10:30 lab tour', 'tour', 'in_person', 'tour', '2030-11-13T10:30:00Z', '2030-11-13T11:15:00Z', 10, 1, NULL, 0),
  ('2030-11-13-example-tour-1115', '2030-11-13-example', '11:15 lab tour', 'tour', 'in_person', 'tour', '2030-11-13T11:15:00Z', '2030-11-13T12:00:00Z', 10, 2, NULL, 0),
  ('2030-11-13-example-talks-am', '2030-11-13-example', 'Welcome and talks', 'talk', 'hybrid', NULL, '2030-11-13T12:00:00Z', '2030-11-13T13:00:00Z', NULL, 3, NULL, 0),
  ('2030-11-13-example-talks-pm', '2030-11-13-example', 'Talks and discussion', 'talk', 'hybrid', NULL, '2030-11-13T14:00:00Z', '2030-11-13T16:30:00Z', NULL, 4, NULL, 0),
  ('2030-11-13-example-dinner', '2030-11-13-example', 'Dinner', 'social', 'in_person', NULL, '2030-11-13T17:00:00Z', '2030-11-13T20:00:00Z', 10, 5, 'The Example Arms, 2 Example Street, Glasgow', 1);

INSERT OR IGNORE INTO instructions (event_id, version, subject, body_md, change_note, created_at, created_by) VALUES
  ('2030-11-13-example', 1, 'Joining instructions: Example Community Day, 13 November 2030',
':::in-person
**Where:** Room 12, Example Hall, 1 Example Street, Glasgow. Please sign in at reception.

**Schedule (UK time):**

- 10:30 First optional lab tour
- 11:15 Second optional lab tour
- 12:00 Welcome and talks
- 13:00 Lunch
- 14:00 Talks and discussion
- 16:30 Close
- 17:00 Dinner, for those who signed up

Closed shoes are needed in the labs.
:::

:::remote
**Joining remotely:** the talks are online from 12:00 to 13:00 and from 14:00 to 16:30 (UK time). The links will be in your calendar entries.
:::

:::extras
**Dinner:** 17:00 at The Example Arms, 2 Example Street, Glasgow. Pay for your own on the night.
:::

To change or cancel your registration, use your personal link below.', 'First version', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'setup');
