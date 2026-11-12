-- v15 (additive, new table only): server-issued challenge codes (M4) + challenge video.
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
