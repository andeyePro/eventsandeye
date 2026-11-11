-- Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
-- A poll's totals (never names or anyone's ranking) can be made public, for a slide or a page showing them live.
-- Off unless an organiser turns it on for that poll.
ALTER TABLE polls ADD COLUMN public_results INTEGER NOT NULL DEFAULT 0;
