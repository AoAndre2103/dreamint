-- v18 (additive): buyer/seller chat per listing, blocks, reports. No existing row is modified.
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
