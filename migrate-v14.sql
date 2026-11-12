-- v14 (additive only, no writes on existing rows): soft archive + ownership history.
ALTER TABLE slabs ADD COLUMN archived_at TEXT;
ALTER TABLE slabs ADD COLUMN archived_reason TEXT;
CREATE TABLE IF NOT EXISTS slab_owner_history (
  id TEXT PRIMARY KEY,
  slab_id TEXT NOT NULL,
  from_user_id TEXT,
  to_user_id TEXT,
  reason TEXT NOT NULL,
  sale_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slab_owner_history_slab ON slab_owner_history(slab_id, created_at);
