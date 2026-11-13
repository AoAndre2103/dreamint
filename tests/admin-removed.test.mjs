import test from "node:test";
import assert from "node:assert/strict";
import { isHiddenCard, ADMIN_REMOVED } from "../functions/lib/visibility.js";
import { IP_RULES, SUPPORT_USER_RULE } from "../functions/lib/rate-limit.js";

test("isHiddenCard: admin_removed cards are hidden for everyone except admins", () => {
  const removed = { is_test: 0, archived_at: "2026-11-13T00:00:00Z", archived_reason: ADMIN_REMOVED };
  assert.equal(isHiddenCard(removed, null), true);
  assert.equal(isHiddenCard(removed, { role: "user" }), true);
  assert.equal(isHiddenCard(removed, { role: "admin" }), false);
});
test("isHiddenCard: sold_outside archive and normal cards are unchanged; test cards still admin-only", () => {
  assert.equal(isHiddenCard({ is_test: 0, archived_at: "x", archived_reason: "sold_outside" }, null), false);
  assert.equal(isHiddenCard({ is_test: 0, archived_at: null }, null), false);
  assert.equal(isHiddenCard({ is_test: 1 }, { role: "user" }), true);
  assert.equal(isHiddenCard({ is_test: 1 }, { role: "admin" }), false);
});
test("support rate limits: 10/h per IP on POST /api/support, 3/h per user", () => {
  const r = IP_RULES.find((x) => x.name === "support");
  assert.ok(r && r.test("POST", "support") && !r.test("GET", "support") && !r.test("POST", "admin/support"));
  assert.equal(r.limit, 10); assert.equal(r.windowSec, 3600);
  assert.equal(SUPPORT_USER_RULE.limit, 3); assert.equal(SUPPORT_USER_RULE.windowSec, 3600);
});
