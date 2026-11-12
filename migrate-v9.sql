-- Daily market price history (one row per card per day). Never invent prices.
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
