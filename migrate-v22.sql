-- v22 (additive only, no writes on existing rows): fingerprint of a card submission
-- (same user + same card + same front photo) used by POST /api/cards to collapse
-- double submits made within 5 minutes. Existing rows keep NULL.
ALTER TABLE slabs ADD COLUMN submit_fingerprint TEXT;
CREATE INDEX IF NOT EXISTS idx_slabs_submit_fp ON slabs(submitter_id, submit_fingerprint);
