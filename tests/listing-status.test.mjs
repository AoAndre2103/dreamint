import test from "node:test";
import assert from "node:assert/strict";
import { listingBlockedReason, LISTING_BLOCKED_REASONS } from "../functions/lib/listing-status.js";
const base = { status: "approved", is_ungraded: 1, asking_price_cents: 1200, physical_owner_id: "u", digital_owner_id: "u", opened_at: null };
const PP = "seller@example.com";
test("listed card -> null", () => assert.equal(listingBlockedReason({ ...base, listing_id: "l", listing_status: "active" }, PP), null));
test("reasons in maybeAutoList order", () => {
  assert.equal(listingBlockedReason({ ...base, archived_at: "x" }, PP), "archived");
  assert.equal(listingBlockedReason({ ...base, status: "in_review" }, PP), "in_review");
  assert.equal(listingBlockedReason({ ...base, status: "rejected" }, PP), "rejected");
  assert.equal(listingBlockedReason({ ...base, status: "in_transit" }, PP), "not_available");
  assert.equal(listingBlockedReason({ ...base, is_ungraded: 0 }, PP), "not_opened");
  assert.equal(listingBlockedReason({ ...base, is_ungraded: 0, opened_at: "x", digital_owner_id: "v" }, PP), "not_full_owner");
  assert.equal(listingBlockedReason({ ...base, asking_price_cents: null }, PP), "no_price");
  assert.equal(listingBlockedReason(base, ""), "no_paypal");
  assert.equal(listingBlockedReason(base, "not-an-email"), "no_paypal");
  assert.equal(listingBlockedReason(base, PP), "auto_list_pending");
});
test("every reason is documented", () => {
  for (const r of ["archived", "in_review", "rejected", "not_available", "not_opened", "not_full_owner", "no_price", "no_paypal", "auto_list_pending"]) assert.ok(LISTING_BLOCKED_REASONS[r]);
});
