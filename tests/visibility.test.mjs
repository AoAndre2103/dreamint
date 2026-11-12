import test from "node:test";
import assert from "node:assert/strict";
import { canSeeTest, testVisibleSql, isHiddenTest } from "../functions/lib/visibility.js";

test("canSeeTest is true only for admins", () => {
  assert.equal(canSeeTest(null), false);
  assert.equal(canSeeTest(undefined), false);
  assert.equal(canSeeTest({}), false);
  assert.equal(canSeeTest({ role: "user" }), false);
  assert.equal(canSeeTest({ role: "admin" }), true);
});

test("testVisibleSql hides is_test rows unless the viewer is an admin", () => {
  assert.equal(testVisibleSql(null), "s.is_test = 0");
  assert.equal(testVisibleSql({ role: "user" }, "sl"), "sl.is_test = 0");
  assert.equal(testVisibleSql({ role: "admin" }), "1=1");
});

test("isHiddenTest: non-admin cannot see is_test=1, admin can, normal cards stay visible", () => {
  const card = { is_test: 1 };
  const normal = { is_test: 0 };
  assert.equal(isHiddenTest(card, null), true);
  assert.equal(isHiddenTest(card, { role: "user" }), true);
  assert.equal(isHiddenTest(card, { role: "admin" }), false);
  assert.equal(isHiddenTest(normal, null), false);
  assert.equal(isHiddenTest(null, { role: "admin" }), false);
});
