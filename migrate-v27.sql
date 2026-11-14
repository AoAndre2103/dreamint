-- v27 (additive only, no writes on existing rows): recensioni tra venditore e acquirente.
-- Una recensione a testa per vendita completata. Visibile quando hanno recensito entrambi o dopo 14 giorni.
-- hidden_at/hidden_by: nascosta da un admin (soft, reversibile a mano su D1).
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  reviewee_id TEXT NOT NULL,
  reviewee_role TEXT NOT NULL CHECK (reviewee_role IN ('seller','buyer')),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL,
  hidden_at TEXT,
  hidden_by TEXT,
  UNIQUE (sale_id, reviewer_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON reviews(reviewee_id, created_at);
