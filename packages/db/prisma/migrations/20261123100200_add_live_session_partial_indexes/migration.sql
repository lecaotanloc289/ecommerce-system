-- Partial unique indexes Prisma cannot model (WHERE clauses). Hand-written.

-- At most one LIVE session per vendor.
CREATE UNIQUE INDEX live_sessions_one_live_per_vendor_key ON live_sessions (vendor_id) WHERE status = 'LIVE';

-- At most one pinned product per live session.
CREATE UNIQUE INDEX live_session_products_one_pinned_key ON live_session_products (live_session_id) WHERE pinned_at IS NOT NULL;
