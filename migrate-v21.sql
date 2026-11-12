-- v21 (additive): plaintext transfer codes are stored only so the current digital
-- owner can read them via GET /api/cards/:id/certificate. The hash on slabs stays
-- the source of truth for redeem. No existing row is modified.
CREATE TABLE IF NOT EXISTS transfer_code_reveals (
  slab_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transfer_code_reveals_user ON transfer_code_reveals(user_id);
