-- Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
-- How many times an unconfirmed registration for an address has been replaced by a new one. Each replacement sends a
-- fresh confirm-your-email message, so after a few the address is left alone until it confirms or the hold lapses.
ALTER TABLE registrations ADD COLUMN resends INTEGER NOT NULL DEFAULT 0;
