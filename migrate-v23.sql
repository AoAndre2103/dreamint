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
