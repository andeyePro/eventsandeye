-- Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
-- A registrant can ask that no images of them from the event are shared; the organiser is told, the registrant is emailed,
-- and the admin page shows it.
ALTER TABLE registrations ADD COLUMN no_images INTEGER NOT NULL DEFAULT 0;
