-- v12 (additive only): sale lock + rate limits.
ALTER TABLE listings ADD COLUMN reserved_sale_id TEXT;
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
-- At most one sale per listing can hold it (accepted / paid / shipped).
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_one_holder ON sales(listing_id) WHERE status IN ('accepted','paid','shipped');
