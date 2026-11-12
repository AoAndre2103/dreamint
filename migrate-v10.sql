-- Launch state machine (BETA -> LAUNCH_PROMO -> PROMO_ENDED -> MONETIZATION_ENABLED).
-- Default when no row exists: BETA. Only admins change it, every change is logged.
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
