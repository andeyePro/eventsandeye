-- Events&I: opt-in sessions (e.g. dinner) can now have a capacity, with a waiting list like the tours. registrations.optins
-- stays the list of sessions the person asked for; optins_waiting is the subset they are waiting for, and
-- optins_waitlist_since orders that waiting list. Freed places are handed out by an admin, as for tours.
ALTER TABLE registrations ADD COLUMN optins_waiting TEXT;
ALTER TABLE registrations ADD COLUMN optins_waitlist_since TEXT;
