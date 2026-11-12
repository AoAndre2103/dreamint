-- v17 (additive): graded cards sold on two markets — «Full Set» (physical + digital) and «Solo digitale» —
-- plus «Solo carta fisica» when physical and digital owners differ. No existing row is modified:
-- listings/sales with kind NULL are legacy and treated as 'fullset' (ungraded: the whole card, unchanged).
ALTER TABLE listings ADD COLUMN kind TEXT;               -- 'fullset' | 'digital' | 'physical' | NULL (legacy = fullset)
ALTER TABLE listings ADD COLUMN paused_by_sale_id TEXT;  -- set while a conflicting sale holds the card (status 'paused')
ALTER TABLE sales ADD COLUMN kind TEXT;                  -- copy of the listing kind at request time (NULL = legacy fullset)
ALTER TABLE slabs ADD COLUMN price_digital_cents INTEGER;   -- «Solo digitale» price (digital owner)
ALTER TABLE slabs ADD COLUMN price_physical_cents INTEGER;  -- «Solo carta fisica» price (physical owner, split only)
ALTER TABLE slab_owner_history ADD COLUMN part TEXT;     -- 'fullset' | 'digital' | 'physical' | NULL (legacy = whole card)
CREATE INDEX IF NOT EXISTS idx_listings_slab_status ON listings(slab_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_paused_by ON listings(paused_by_sale_id);
CREATE INDEX IF NOT EXISTS idx_slabs_certificate ON slabs(certificate_no);
