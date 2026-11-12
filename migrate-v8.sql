-- Digital certificate, transfer codes, and off-platform recovery claims.

ALTER TABLE slabs ADD COLUMN transfer_code_hash TEXT;
ALTER TABLE slabs ADD COLUMN transfer_code_created_at TEXT;

CREATE TABLE IF NOT EXISTS digital_claims (
  id TEXT PRIMARY KEY,
  slab_id TEXT NOT NULL,
  claimant_id TEXT NOT NULL,
  grader TEXT,
  certificate_no TEXT,
  message TEXT,
  status TEXT NOT NULL,
  admin_note TEXT,
  photo_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  dispute_until TEXT
);

CREATE INDEX IF NOT EXISTS idx_claims_status ON digital_claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_claimant ON digital_claims(claimant_id);
CREATE INDEX IF NOT EXISTS idx_claims_slab ON digital_claims(slab_id);

CREATE TABLE IF NOT EXISTS transfer_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_xfer_attempts_user ON transfer_attempts(user_id, created_at);
