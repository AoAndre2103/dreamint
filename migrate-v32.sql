-- DreaMint v32: codici monouso per passare carte non gradate vendute fuori DreaMint.
CREATE TABLE IF NOT EXISTS ungraded_transfer_codes (
  slab_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  code_hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_raw_transfer_owner ON ungraded_transfer_codes(owner_id);
