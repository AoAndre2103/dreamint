-- v36: Segui utenti e notifiche in-app per nuove carte pubblicate.
-- Migrazione additiva, non modifica tabelle esistenti.
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id TEXT NOT NULL,
  followed_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (follower_id, followed_id),
  CHECK (follower_id <> followed_id)
);
CREATE INDEX IF NOT EXISTS idx_user_follows_followed ON user_follows(followed_id, follower_id);

CREATE TABLE IF NOT EXISTS follow_notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'new_card',
  created_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE (recipient_id, card_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_follow_notifications_recipient ON follow_notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_notifications_unread ON follow_notifications(recipient_id, read_at);
