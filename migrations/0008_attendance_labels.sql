-- Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
-- Each event's own wording for the two ways to attend and for its optional tours, used by the booking form and the
-- manage page (a component's props still win, for sites that set them). NULL = the plain defaults.
ALTER TABLE events ADD COLUMN in_person_label TEXT;
ALTER TABLE events ADD COLUMN remote_label TEXT;
ALTER TABLE events ADD COLUMN tour_legend TEXT;
