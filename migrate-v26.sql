-- v26 (additive only, no writes on existing rows): plan preference chosen at signup / at the next login.
-- BETA: it is only a preference (no charge, no commission, no subscription). NULL = not chosen yet.
ALTER TABLE users ADD COLUMN plan TEXT;
ALTER TABLE users ADD COLUMN plan_chosen_at TEXT;
