ALTER TABLE users ADD COLUMN paypal_email TEXT;
ALTER TABLE sales ADD COLUMN paid_at TEXT;
ALTER TABLE sales ADD COLUMN paypal_txn_id TEXT;
ALTER TABLE sales ADD COLUMN paypal_order_id TEXT;
