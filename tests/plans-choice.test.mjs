// v26: mandatory plan choice (preference only), admins exempt by role only.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizePlanId, isPlanExempt, needsPlanChoice, effectivePlan } from "../functions/lib/plans.js";

test("normalizePlanId accepts only the 3 plans", () => {
  assert.equal(normalizePlanId("free"), "free");
  assert.equal(normalizePlanId(" PRO "), "pro");
  assert.equal(normalizePlanId("business"), "business");
  for (const v of [undefined, null, "", "gold", 1, {}, "exempt"]) assert.equal(normalizePlanId(v), null);
});

test("admin exempt only via role; owner email without admin role is NOT exempt", () => {
  assert.equal(isPlanExempt({ role: "admin" }), true);
  assert.equal(needsPlanChoice({ role: "admin", plan: null }), false);
  assert.deepEqual(effectivePlan({ role: "admin" }), { id: "exempt", exempt: true, monthly_cents: 0, fee_bps: 0 });
  const ownerNotAdmin = { role: "user", email: "owner@example.com", plan: null };
  assert.equal(isPlanExempt(ownerNotAdmin), false);
  assert.equal(needsPlanChoice(ownerNotAdmin), true);
  assert.equal(needsPlanChoice({ role: "user", plan: "pro" }), false);
  assert.equal(effectivePlan({ role: "user", plan: "pro" }).fee_bps, 200);
});

test("migration v26 is additive", () => {
  const sql = fs.readFileSync(new URL("../migrate-v26.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
  assert.ok(/ALTER TABLE users ADD COLUMN plan TEXT/.test(sql) && /plan_chosen_at/.test(sql));
  assert.ok(!/\b(UPDATE|DELETE|DROP|INSERT)\b/i.test(sql));
});
