-- Partial index for the outbox dispatcher's claim query
-- (`WHERE processed_at IS NULL ORDER BY created_at, id ... FOR UPDATE SKIP LOCKED`).
-- Stays small as processed rows accumulate. Hand-written: Prisma cannot model a WHERE clause.
CREATE INDEX outbox_events_pending_idx ON outbox_events (created_at, id) WHERE processed_at IS NULL;
