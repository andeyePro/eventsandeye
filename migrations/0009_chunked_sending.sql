-- Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
-- Sending to a whole event in pieces, so no single request goes over the Workers free plan's limits (50 D1 queries
-- and 50 outbound requests per invocation). A message being sent is claimed for a few minutes at a time and finished
-- by the cron Worker; who has it is read from its delivery records, so a piece that fails is retried without resending
-- to anyone. started_at fixes its audience: people who confirm after it started are not added part way.
ALTER TABLE messages ADD COLUMN claimed_until TEXT;
ALTER TABLE messages ADD COLUMN started_at TEXT;
-- Calendar updates after a session change beyond the first few are queued here, and sent by the cron Worker.
ALTER TABLE registrations ADD COLUMN calendar_dirty INTEGER NOT NULL DEFAULT 0;
