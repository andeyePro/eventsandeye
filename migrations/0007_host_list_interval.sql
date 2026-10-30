-- Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
-- At most one attendee list per session host every this many minutes (0 = every change, as before). Changes in between
-- are gathered into the next list, which the cron Worker sends once the interval has passed. Within a day of a session
-- its host gets every change at once.
ALTER TABLE events ADD COLUMN host_list_minutes INTEGER NOT NULL DEFAULT 0;
