-- v30: proposte di prezzo tra acquirenti e venditori. Solo tabelle/indici nuovi.
-- Accettare una proposta non blocca la carta: il primo pagamento confermato vince.
CREATE TABLE IF NOT EXISTS price_offers (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  slab_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  buyer_id TEXT NOT NULL,
  offer_cents INTEGER NOT NULL CHECK (offer_cents > 0),
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled','converted')),
  sale_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_offers_seller ON price_offers(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_offers_buyer ON price_offers(buyer_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_offers_buyer_open ON price_offers(listing_id, buyer_id)
  WHERE status IN ('pending','accepted');
