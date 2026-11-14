-- External transfer invitations for ungraded cards. Codes stored only as SHA-256 hashes.
CREATE TABLE IF NOT EXISTS raw_external_transfers (
 id TEXT PRIMARY KEY, slab_id TEXT NOT NULL, sender_id TEXT NOT NULL,
 recipient_id TEXT, code_hash TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('pending','claimed','completed','cancelled')),
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL, claimed_at TEXT, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_raw_external_slab ON raw_external_transfers(slab_id,status);
CREATE INDEX IF NOT EXISTS idx_raw_external_recipient ON raw_external_transfers(recipient_id,status);

-- A buyer can block automatic transfer while a shipping dispute is open.
CREATE TABLE IF NOT EXISTS sale_disputes (
 sale_id TEXT NOT NULL, buyer_id TEXT NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('open','resolved')),
 created_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_disputes_one_open ON sale_disputes(sale_id) WHERE status='open';
