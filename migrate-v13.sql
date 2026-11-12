-- v13 (additive): email verification. (Challenge codes M4 moved to migrate-v15.sql.)
-- The only write on existing rows: users that exist at migration time are marked as verified
-- (grandfathered), so nobody already registered gets blocked. New signups start unverified.
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
UPDATE users SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);
