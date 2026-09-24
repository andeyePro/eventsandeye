-- Example event for Events&I. Apply after the migrations:
--   npx wrangler d1 execute <db> --remote --file eventsandeye/examples/seed.example.sql
-- All times are UTC. Numbers, deadlines, links and hosts are editable later from /admin/rsvps/.

INSERT INTO events (id, title, starts_at, ends_at, timezone, location, in_person_max, deadline, travel_minutes, page_path) VALUES
  ('2027-03-05-example', 'Example community day', '2027-03-05T10:00:00Z', '2027-03-05T18:00:00Z', 'Europe/London',
   'Example Hall, 1 Example Street, Glasgow', 30, '2027-02-26T23:59:00Z', 45, '/events/2027-03-05-example/');

-- Optional sessions share a choice_group ('tour' is the group the booking form offers today); core sessions have none.
INSERT INTO sessions (id, event_id, label, kind, mode, choice_group, starts_at, ends_at, capacity, sort) VALUES
  ('2027-03-05-example-tour-1', '2027-03-05-example', '10:00 workshop tour', 'tour', 'in_person', 'tour', '2027-03-05T10:00:00Z', '2027-03-05T10:45:00Z', 8, 1),
  ('2027-03-05-example-talks', '2027-03-05-example', 'Talks', 'talk', 'hybrid', NULL, '2027-03-05T11:00:00Z', '2027-03-05T16:00:00Z', NULL, 2),
  ('2027-03-05-example-social', '2027-03-05-example', 'Drinks', 'social', 'in_person', NULL, '2027-03-05T16:30:00Z', '2027-03-05T18:00:00Z', NULL, 3);

INSERT INTO instructions (event_id, version, subject, body_md, change_note, created_at, created_by) VALUES
  ('2027-03-05-example', 1, 'Joining instructions: Example community day', 'Thank you for registering. **Where:** Example Hall. Your calendar invitations are attached.', 'First version', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'setup');
