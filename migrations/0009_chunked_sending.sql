-- Events&I – Copyright (C) 2026 andeye Ltd. AGPL-3.0, see ../LICENSE.
-- Sending to a whole event in pieces, so no single request goes over the Workers free plan's limits (50 D1 queries
-- and 50 outbound requests per invocation). A message being sent is claimed for a few minutes at a time (claimed_until
-- holds the claimant's token too) and finished by the cron Worker; who has it is read from its delivery records, so a
-- piece that fails is retried without resending to anyone. recipient_ids fixes its audience when sending starts.
-- attempts counts failed pieces: after a few, the message is marked failed, so it cannot hold up the others.
ALTER TABLE messages ADD COLUMN claimed_until TEXT;
ALTER TABLE messages ADD COLUMN started_at TEXT;
ALTER TABLE messages ADD COLUMN recipient_ids TEXT;
ALTER TABLE messages ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
-- Calendar updates after a session change: 1 = to send (the first few go at once, the cron sends the rest); each
-- failed try adds one, and after a few the person is left for their next email to catch up.
ALTER TABLE registrations ADD COLUMN calendar_dirty INTEGER NOT NULL DEFAULT 0;
-- Local development only: the idempotency key a send carried, so the dev outbox behaves like Resend on a retry.
ALTER TABLE dev_outbox ADD COLUMN idempotency_key TEXT;
