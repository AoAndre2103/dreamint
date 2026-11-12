-- v19 (additive, safety): listings.reserved_sale_id may already exist from v12.
-- Some local D1 databases were created without v12, and GET /api/cards/:id then
-- returns 500 because the server SELECTs this column. Do not run if the column
-- is already present (DEPLOY.sh probes pragma_table_info). Type is TEXT, as in
-- schema.sql / migrate-v12.sql (sale ids are UUID strings, not integers).
ALTER TABLE listings ADD COLUMN reserved_sale_id TEXT;
