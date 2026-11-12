import test from "node:test";
import assert from "node:assert/strict";
import { requiresVerifiedEmail, randomChallengeCode, randomTokenHex, verificationEmail, isEmailVerified, emailNotVerifiedError } from "../functions/lib/email-verify.js";

test("gate covers sell / buy / redeem endpoints", () => {
  for (const [m, p] of [["POST", "cards"], ["POST", "cards/challenge"], ["POST", "catalog"], ["POST", "cards/a/photos"], ["POST", "listings"],
    ["PATCH", "listings/a"], ["PATCH", "cards/a/price"], ["POST", "listings/a/request"], ["POST", "sales/a/accept"], ["POST", "sales/a/ship"],
    ["POST", "sales/a/receive"], ["POST", "sales/a/mark-paid"], ["POST", "sales/a/paypal/order"], ["POST", "sales/a/paypal/capture"],
    ["GET", "sales/a/paypal-link"], ["POST", "copies/redeem"], ["POST", "claims"], ["POST", "cards/a/transfer-code"]]) {
    assert.equal(requiresVerifiedEmail(m, p), true, m + " " + p);
  }
});
test("gate leaves browsing, auth, profile and cancel open", () => {
  for (const [m, p] of [["GET", "market"], ["GET", "cards"], ["GET", "cards/a"], ["GET", "me"], ["PATCH", "me"], ["POST", "auth/login"], ["POST", "auth/signup"],
    ["POST", "auth/logout"], ["POST", "auth/resend-verification"], ["GET", "auth/verify-email"], ["POST", "sales/a/cancel"], ["GET", "sales"], ["POST", "paypal/ipn"], ["POST", "cards/a/open"]]) {
    assert.equal(requiresVerifiedEmail(m, p), false, m + " " + p);
  }
});
test("challenge code: 8 chars from the unambiguous alphabet, random", () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) { const c = randomChallengeCode(); assert.match(c, /^[A-HJ-NP-Z2-9]{8}$/); seen.add(c); }
  assert.ok(seen.size > 1990);
});
test("token is 64 hex chars", () => { assert.match(randomTokenHex(32), /^[0-9a-f]{64}$/); assert.notEqual(randomTokenHex(32), randomTokenHex(32)); });
test("email text is Italian, says DreaMint, never Gemint, escapes html", () => {
  const m = verificationEmail("<b>Ann</b>", "https://dreamint.it/api/auth/verify-email?token=" + "a".repeat(64));
  assert.match(m.subject, /DreaMint/);
  assert.match(m.text, /24 ore/);
  assert.doesNotMatch(m.subject + m.text + m.html, /gemint/i);
  assert.doesNotMatch(m.html, /<b>Ann/);
});
test("verified flag + error code", () => {
  assert.equal(isEmailVerified({ email_verified_at: null }), false);
  assert.equal(isEmailVerified({ email_verified_at: "2026-11-12T00:00:00Z" }), true);
  const e = emailNotVerifiedError(); assert.equal(e.status, 403); assert.equal(e.code, "email_not_verified");
});
