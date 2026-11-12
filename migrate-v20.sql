-- v20 (additive for data; index only): there is no reservation.
-- Full Set and Solo digitale stay independently buyable until a payment is
-- confirmed. The old unique index blocked a second 'accepted' sale on the same
-- listing (and blocked paying one sale while another was 'accepted'). After
-- this change the uniqueness applies only to paid/shipped. No existing row is
-- modified.
DROP INDEX IF EXISTS idx_sales_one_holder;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_one_paid ON sales(listing_id) WHERE status IN ('paid','shipped');
