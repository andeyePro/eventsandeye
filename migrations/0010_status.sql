-- Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
-- What the cron Worker leaves for the admin page's set-up check: when it last ran, and fingerprints of its settings, so
-- a cron Worker that never runs, or whose TOKEN_SECRET or SITE_URL differ from the site's, is noticed before anyone
-- is sent a broken link.
CREATE TABLE status (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
