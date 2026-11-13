CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'Italia',
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  is_test INTEGER NOT NULL DEFAULT 0,
  paypal_email TEXT,
  referred_by_partner_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_referred ON users(referred_by_partner_id);

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

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_models (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  set_name TEXT NOT NULL,
  set_code TEXT,
  code_printed TEXT NOT NULL,
  code_normalized TEXT NOT NULL,
  name TEXT NOT NULL,
  language TEXT NOT NULL,
  variant TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  catalog_image TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (game, set_name, code_normalized, language, variant)
);

CREATE INDEX IF NOT EXISTS idx_models_code ON card_models(code_normalized);
CREATE INDEX IF NOT EXISTS idx_models_name ON card_models(name);

CREATE TABLE IF NOT EXISTS card_model_counters (
  card_model_id TEXT PRIMARY KEY,
  last_serial INTEGER NOT NULL DEFAULT 0,
  registered_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS slabs (
  id TEXT PRIMARY KEY,
  card_model_id TEXT NOT NULL,
  submitter_id TEXT NOT NULL,
  physical_owner_id TEXT NOT NULL,
  digital_owner_id TEXT NOT NULL,
  grader TEXT NOT NULL,
  certificate_no TEXT NOT NULL,
  grade TEXT,
  is_ungraded INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  challenge_code TEXT,
  challenge_expires_at TEXT,
  rejection_reason TEXT,
  server_seed TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  client_nonce TEXT NOT NULL,
  digest TEXT,
  roll REAL,
  rarity_tier TEXT,
  serial_number INTEGER,
  serial_total_at_assignment INTEGER,
  assigned_at TEXT,
  opened_at TEXT,
  created_at TEXT NOT NULL,
  card_condition TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,
  asking_price_cents INTEGER,
  cardmarket_avg_cents INTEGER,
  transfer_code_hash TEXT,
  transfer_code_created_at TEXT,
  UNIQUE (grader, certificate_no)
);

CREATE INDEX IF NOT EXISTS idx_slabs_owner ON slabs(physical_owner_id, digital_owner_id);
CREATE INDEX IF NOT EXISTS idx_slabs_status ON slabs(status);
CREATE INDEX IF NOT EXISTS idx_slabs_model ON slabs(card_model_id);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  slab_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  shipping_note TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  slab_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  message TEXT,
  contact TEXT,
  status TEXT NOT NULL,
  tracking TEXT,
  created_at TEXT NOT NULL,
  shipped_at TEXT,
  received_at TEXT,
  paid_at TEXT,
  paypal_txn_id TEXT,
  paypal_order_id TEXT,
  shipping_method TEXT,
  shipping_cents INTEGER NOT NULL DEFAULT 0,
  insurance INTEGER NOT NULL DEFAULT 0,
  insurance_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER,
  shipping_dest TEXT,
  tracking_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_parties ON sales(seller_id, buyer_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  payload TEXT,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO card_models (id, game, set_name, set_code, code_printed, code_normalized, name, language, variant, slug, created_at) VALUES
 ('m_drago_ita', 'fictional_demo', 'Alba Eterna', 'AE', '012/080', '12/80', 'Drago Solare', 'ITA', 'normal', 'fictional-demo-alba-eterna-012-080-ita-normal', '2026-11-10T00:00:00Z'),
 ('m_drago_eng', 'fictional_demo', 'Alba Eterna', 'AE', '012/080', '12/80', 'Solar Dragon', 'ENG', 'normal', 'fictional-demo-alba-eterna-012-080-eng-normal', '2026-11-10T00:00:00Z'),
 ('m_mep_ita', 'fictional_demo', 'Promo Stelle', 'MEP', 'MEP 080', 'MEP080', 'Guardiola Astrale', 'ITA', 'promo', 'fictional-demo-promo-stelle-mep-080-ita-promo', '2026-11-10T00:00:00Z'),
 ('m_swsh', 'fictional_demo', 'Set Primordiale', 'SWSH', 'SWSH050', 'SWSH050', 'Sentinella d''Ombra', 'ITA', 'holo', 'fictional-demo-set-primordiale-swsh050-ita-holo', '2026-11-10T00:00:00Z'),
 ('m_op', 'fictional_demo', 'Mare Inizio', 'OP01', 'OP01-120', 'OP01-120', 'Capitano della Bussola', 'ITA', 'alt_art', 'fictional-demo-mare-inizio-op01-120-ita-alt-art', '2026-11-10T00:00:00Z'),
 ('m_58_ita', 'fictional_demo', 'Set Primordiale', 'SP', '58/102', '58/102', 'Falco di Quarzo', 'ITA', 'holo', 'fictional-demo-set-primordiale-58-102-ita-holo', '2026-11-10T00:00:00Z'),
 ('m_58_eng', 'fictional_demo', 'Set Primordiale', 'SP', '58/102', '58/102', 'Quartz Falcon', 'ENG', 'holo', 'fictional-demo-set-primordiale-58-102-eng-holo', '2026-11-10T00:00:00Z');

INSERT OR IGNORE INTO card_model_counters (card_model_id, last_serial, registered_count)
SELECT id, 0, 0 FROM card_models;

-- v11
CREATE UNIQUE INDEX IF NOT EXISTS idx_slabs_model_serial ON slabs(card_model_id, serial_number) WHERE serial_number IS NOT NULL;

-- v12
ALTER TABLE listings ADD COLUMN reserved_sale_id TEXT;
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_one_holder ON sales(listing_id) WHERE status IN ('accepted','paid','shipped');

-- v13
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

-- v14
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

-- v15
CREATE TABLE IF NOT EXISTS challenge_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  slab_id TEXT,
  video_key TEXT,
  video_mime TEXT,
  video_size INTEGER,
  video_duration_ms INTEGER,
  video_uploaded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_challenge_codes_user ON challenge_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_challenge_codes_slab ON challenge_codes(slab_id);

-- v16 (migrate-v16.sql): public username + album visibility
ALTER TABLE users ADD COLUMN username TEXT NULL;
ALTER TABLE users ADD COLUMN album_public INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lc ON users (lower(username)) WHERE username IS NOT NULL;

-- v17 (migrate-v17.sql): two markets for graded cards
ALTER TABLE listings ADD COLUMN kind TEXT;
ALTER TABLE listings ADD COLUMN paused_by_sale_id TEXT;
ALTER TABLE sales ADD COLUMN kind TEXT;
ALTER TABLE slabs ADD COLUMN price_digital_cents INTEGER;
ALTER TABLE slabs ADD COLUMN price_physical_cents INTEGER;
ALTER TABLE slab_owner_history ADD COLUMN part TEXT;
CREATE INDEX IF NOT EXISTS idx_listings_slab_status ON listings(slab_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_paused_by ON listings(paused_by_sale_id);
CREATE INDEX IF NOT EXISTS idx_slabs_certificate ON slabs(certificate_no);
-- v18 (migrate-v18.sql): chat
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  slab_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_message_at TEXT,
  buyer_last_read_at TEXT,
  seller_last_read_at TEXT,
  UNIQUE (listing_id, buyer_id)
);
CREATE INDEX IF NOT EXISTS idx_conversations_buyer ON conversations(buyer_id, last_message_at);
CREATE INDEX IF NOT EXISTS idx_conversations_seller ON conversations(seller_id, last_message_at);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  body TEXT NOT NULL,            -- raw plain text (max 1000 chars), rendered as text by the frontend
  created_at TEXT NOT NULL,
  warning INTEGER NOT NULL DEFAULT 0,
  warning_codes TEXT             -- comma list: off_platform_payment,email,phone,external_link
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS chat_reports (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT,
  reporter_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
);
CREATE INDEX IF NOT EXISTS idx_chat_reports_status ON chat_reports(status, created_at);

-- v19 (safety): listings.reserved_sale_id is already added in the v12 section above.

-- v20: a listing is held only once a sale is paid (no reservation on accept).
DROP INDEX IF EXISTS idx_sales_one_holder;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_one_paid ON sales(listing_id) WHERE status IN ('paid','shipped');

-- v21: current transfer code, readable only by the digital owner via the certificate API.
CREATE TABLE IF NOT EXISTS transfer_code_reveals (
  slab_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transfer_code_reveals_user ON transfer_code_reveals(user_id);

-- v8 objects (already applied in production via migrate-v8.sql; included here so a fresh local D1 is complete).
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

-- v9 (already on production): daily market price history.
CREATE TABLE IF NOT EXISTS price_history (
  game TEXT NOT NULL,
  card_ref TEXT NOT NULL,
  currency TEXT NOT NULL,
  source TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (game, card_ref, currency, source, day)
);
CREATE INDEX IF NOT EXISTS idx_price_history_lookup ON price_history(game, card_ref, currency, source, day);

-- v10 (already on production): launch state machine.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS launch_state_log (
  id TEXT PRIMARY KEY,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_email TEXT,
  promo_start TEXT,
  promo_end TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_launch_log_created ON launch_state_log(created_at);
-- v22 (additive only, no writes on existing rows): fingerprint of a card submission
-- (same user + same card + same front photo) used by POST /api/cards to collapse
-- double submits made within 5 minutes. Existing rows keep NULL.
ALTER TABLE slabs ADD COLUMN submit_fingerprint TEXT;
CREATE INDEX IF NOT EXISTS idx_slabs_submit_fp ON slabs(submitter_id, submit_fingerprint);
-- v23 (additive only, no writes on existing rows): «Assistenza» requests from logged-in users.
CREATE TABLE IF NOT EXISTS support_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_support_status ON support_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_support_user ON support_requests(user_id, created_at);
