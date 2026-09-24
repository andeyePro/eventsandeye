-- Events&I schema (Cloudflare D1 / SQLite). All timestamps are ISO 8601 UTC strings.
-- Copyright (C) 2026 andeye Ltd. AGPL-3.0, see LICENSE.

CREATE TABLE events (
  id              TEXT PRIMARY KEY,           -- e.g. '2026-11-13-london'
  title           TEXT NOT NULL,
  starts_at       TEXT NOT NULL,
  ends_at         TEXT NOT NULL,              -- retention runs from here
  timezone        TEXT NOT NULL DEFAULT 'Europe/London',
  location        TEXT NOT NULL DEFAULT '',   -- venue address, used for in-person calendar entries
  in_person_max   INTEGER NOT NULL,           -- editable from the admin page
  deadline        TEXT NOT NULL,              -- main registration deadline, editable from the admin page
  travel_minutes  INTEGER NOT NULL DEFAULT 60,-- assumed travel time for the "time to leave" reminder
  page_path       TEXT NOT NULL,              -- public event page path, used in emails
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Programme items. A session with a choice_group (e.g. 'tour') is optional and booked individually: each registrant
-- picks at most one session per group, with its own capacity, waiting list and booking deadline.
-- Sessions without a choice_group are the core programme everyone attends (in person, online or both).
CREATE TABLE sessions (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label             TEXT NOT NULL,
  kind              TEXT NOT NULL DEFAULT 'talk' CHECK (kind IN ('talk','tour','social','other')),
  mode              TEXT NOT NULL DEFAULT 'in_person' CHECK (mode IN ('in_person','online','hybrid')),
  choice_group      TEXT,                     -- NULL = core programme
  starts_at         TEXT NOT NULL,
  ends_at           TEXT NOT NULL,
  location          TEXT,                     -- overrides the event location
  online_url        TEXT,                     -- e.g. the Google Meet link; only ever sent to registrants
  host_name         TEXT,
  host_email        TEXT,                     -- gets the attendee list whenever it changes
  capacity          INTEGER,                  -- NULL = unlimited
  booking_deadline  TEXT,                     -- NULL = until the session starts (choice sessions only)
  sort              INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sessions_event ON sessions (event_id, sort);

CREATE TABLE registrations (
  id                    TEXT PRIMARY KEY,     -- random; links carry id + HMAC(TOKEN_SECRET), see src/tokens.ts
  event_id              TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL,
  attendance            TEXT NOT NULL CHECK (attendance IN ('in_person','remote')),
  affiliation           TEXT,
  needs                 TEXT,                 -- dietary or access needs
  share_contact         INTEGER NOT NULL DEFAULT 0,  -- 1 = registrant agreed to share their email with session hosts
  status                TEXT NOT NULL CHECK (status IN ('pending','confirmed')),
  place                 TEXT CHECK (place IN ('place','waitlist')),        -- in person only; NULL for remote
  tour_id               TEXT REFERENCES sessions(id) ON DELETE SET NULL,   -- chosen session in the 'tour' group
  tour_place            TEXT CHECK (tour_place IN ('place','waitlist')),
  consent_at            TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  confirmed_at          TEXT,
  hold_expires_at       TEXT,                 -- pending registrations are deleted after this
  hold_warned_at        TEXT,
  waitlist_since        TEXT,
  tour_waitlist_since   TEXT,
  instructions_version  INTEGER NOT NULL DEFAULT 0,  -- last joining-instructions version this person received
  calendar_state        TEXT NOT NULL DEFAULT '{}',  -- JSON {entryKey: {seq, hash}} of calendar entries sent
  UNIQUE (event_id, email)
);
CREATE INDEX registrations_event_status ON registrations (event_id, status);

CREATE TABLE instructions (
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  subject      TEXT NOT NULL,
  body_md      TEXT NOT NULL,
  change_note  TEXT,
  created_at   TEXT NOT NULL,
  created_by   TEXT,
  PRIMARY KEY (event_id, version)
);

CREATE TABLE messages (
  id                    TEXT PRIMARY KEY,
  event_id              TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  subject               TEXT NOT NULL,
  body_md               TEXT NOT NULL,
  audience              TEXT NOT NULL,
  marks_instructions_version INTEGER,
  status                TEXT NOT NULL CHECK (status IN ('scheduled','sending','sent','cancelled','failed')),
  scheduled_at          TEXT,
  sent_at               TEXT,
  recipients_count      INTEGER,
  error                 TEXT,
  created_at            TEXT NOT NULL,
  created_by            TEXT
);

CREATE TABLE deliveries (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id  TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,             -- confirm_email, already_registered, instructions, calendar_update, message, cancellation
  message_id       TEXT,
  instructions_version INTEGER,
  sent_at          TEXT NOT NULL,
  provider_id      TEXT
);

-- Last attendee list emailed to each session host, so the next email can show what changed.
CREATE TABLE host_snapshots (
  session_id  TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  snapshot    TEXT NOT NULL,                  -- JSON [{id, name, status}]
  sent_at     TEXT NOT NULL
);

-- Local development only: emails are written here (and to the console) instead of being sent.
CREATE TABLE dev_outbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr     TEXT NOT NULL,
  subject     TEXT NOT NULL,
  text_body   TEXT NOT NULL,
  html_body   TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',     -- JSON [{filename, content_type, content}] (content as text)
  created_at  TEXT NOT NULL
);
