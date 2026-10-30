-- Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
-- Events&I: polls, such as "What shall we do on Saturday?". Registrants rank the options from most to least wanted
-- and draw a line: below it, they would rather stay at home. They can suggest options of their own, which an
-- organiser adds for everyone (in the suggester's words or their own) or turns down, by replying to an email or on the
-- admin page. Ballots are deleted with the registration, so the 30-day retention covers them.

CREATE TABLE polls (
  id                 TEXT PRIMARY KEY,
  event_id           TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  question           TEXT NOT NULL,
  allow_suggestions  INTEGER NOT NULL DEFAULT 1,
  closes_at          TEXT,                     -- NULL = open until the event ends
  sort               INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL
);
CREATE INDEX polls_event ON polls (event_id, sort);

-- 'active' options are shown to everyone. A registrant's suggestion is 'pending' (shown only to them) until an
-- organiser decides: 'active' (label may be reworded; suggested_label keeps the original) or 'rejected'. A suggestion
-- the organiser matches to an existing option is 'rejected' with merged_into naming that option.
CREATE TABLE poll_options (
  id               TEXT PRIMARY KEY,
  poll_id          TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label            TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('active','pending','rejected')),
  suggested_by     TEXT REFERENCES registrations(id) ON DELETE SET NULL,
  suggested_label  TEXT,
  merged_into      TEXT REFERENCES poll_options(id) ON DELETE SET NULL,
  sort             INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  decided_at       TEXT,
  decided_by       TEXT                      -- organiser's address, and whether by email or the admin page
);
CREATE INDEX poll_options_poll ON poll_options (poll_id, sort);

-- ranking: JSON array of option ids, most wanted first. bar: how many of them, from the top, the person would join;
-- the rest are below their line. Options added after they saved are in neither part until they save again.
CREATE TABLE poll_ballots (
  poll_id          TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  registration_id  TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  ranking          TEXT NOT NULL,
  bar              INTEGER NOT NULL,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (poll_id, registration_id)
);

-- Local development only: the reply-to address of each email, so tests can check where replies would go.
ALTER TABLE dev_outbox ADD COLUMN reply_to TEXT;
