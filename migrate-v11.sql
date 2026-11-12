-- v11: random serials must stay unique per card model (no change to existing values).
CREATE UNIQUE INDEX IF NOT EXISTS idx_slabs_model_serial ON slabs(card_model_id, serial_number) WHERE serial_number IS NOT NULL;
