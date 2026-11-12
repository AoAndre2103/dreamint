CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  contact_note TEXT,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_partners_code ON partners(code);
CREATE INDEX IF NOT EXISTS idx_partners_token ON partners(token);

ALTER TABLE users ADD COLUMN referred_by_partner_id TEXT;
CREATE INDEX IF NOT EXISTS idx_users_referred ON users(referred_by_partner_id);
