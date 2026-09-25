-- Events&I: one optional free-text question per event, shown on the booking form (e.g. plans for the day after).
ALTER TABLE events ADD COLUMN extra_question TEXT;
ALTER TABLE registrations ADD COLUMN extra_answer TEXT;
