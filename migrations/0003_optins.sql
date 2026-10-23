-- Events&I: optional sessions people can sign up to without a capacity or waiting list (e.g. dinner), so the
-- organiser knows numbers in advance. sessions.optin marks them; registrations.optins lists the chosen session ids.
ALTER TABLE sessions ADD COLUMN optin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN optins TEXT;
