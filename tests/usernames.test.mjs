import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUsername, normalizeQuery, likeEscape } from "../functions/lib/usernames.js";
test("valid usernames are lower-cased", () => {
  assert.deepEqual(normalizeUsername(" Mario.Rossi_1 "), { ok: true, username: "mario.rossi_1" });
  assert.equal(normalizeUsername("abc").ok, true);
  assert.equal(normalizeUsername("a".repeat(20)).ok, true);
});
test("invalid / reserved usernames -> username_invalid", () => {
  for (const v of ["ab", "a".repeat(21), "a-b", "a b", "ciaò", "", null, 5, "admin", "ADMIN", "admin_2", "dreamint", "the.dreamint", "gemint1", "support", "staff_x", "api", "me", "search"]) {
    const r = normalizeUsername(v);
    assert.equal(r.ok, false, String(v));
    assert.equal(r.code, "username_invalid");
  }
});
test("query 2-30 chars, LIKE wildcards escaped", () => {
  assert.equal(normalizeQuery("a"), null);
  assert.equal(normalizeQuery(" Ab "), "ab");
  assert.equal(normalizeQuery("x".repeat(31)), null);
  assert.equal(likeEscape("a_b%c\\"), "a\\_b\\%c\\\\");
});
