import test from "node:test";
import assert from "node:assert/strict";
import { detectWarnings, maskContacts, cleanMessage } from "../functions/lib/chat.js";
import { kindsConflict, canSellKind, parseMarketPrice, normalizeCertQuery, certSearchValues, effectiveKind } from "../functions/lib/markets.js";
test("chat warnings: off-platform payment, phone, email, links", () => {
  assert.deepEqual(detectWarnings("Ciao, la carta è ancora disponibile?"), []);
  assert.deepEqual(detectWarnings("Ti va bene un bonifico?"), ["off_platform_payment"]);
  for (const t of ["pago con PostePay", "ricarica satispay", "Revolut ok", "in contanti", "facciamo fuori dal sito", "paypal amici e parenti"]) assert.ok(detectWarnings(t).includes("off_platform_payment"), t);
  assert.ok(detectWarnings("chiamami al 333 123 4567").includes("phone"));
  assert.ok(detectWarnings("+39 347-1234567").includes("phone"));
  assert.ok(!detectWarnings("spedisco il 12/11/2026 alle 18:00, prezzo 1.250,00").includes("phone"));
  assert.ok(detectWarnings("scrivimi a mario.rossi@gmail.com").includes("email"));
  assert.ok(detectWarnings("guarda https://example.com/x").includes("external_link"));
  assert.ok(detectWarnings("vedi wa.me/393331234567").includes("external_link"));
  assert.deepEqual(detectWarnings("il certificato è su https://dreamint.it/c/abc"), []);
});
test("chat masking and cleaning", () => {
  assert.equal(maskContacts("mail mario@x.it tel 3331234567"), "mail [email nascosta] tel [telefono nascosto]");
  assert.equal(maskContacts("prezzo 1.250,00 il 12/11"), "prezzo 1.250,00 il 12/11");
  assert.equal(cleanMessage("  ciao\r\nok\u0000\u202E "), "ciao\nok");
});
test("markets: kinds, ownership, prices, cert query", () => {
  assert.equal(effectiveKind(null), "fullset");
  assert.equal(kindsConflict("digital", "physical"), false);
  assert.equal(kindsConflict(null, "digital"), true);
  assert.equal(kindsConflict("physical", "fullset"), true);
  const full = { is_ungraded: 0, physical_owner_id: "a", digital_owner_id: "a" }, split = { is_ungraded: 0, physical_owner_id: "a", digital_owner_id: "b" };
  assert.deepEqual(["fullset", "digital", "physical"].map((k) => canSellKind(full, "a", k)), [true, true, false]);
  assert.deepEqual(["fullset", "digital", "physical"].map((k) => canSellKind(split, "a", k)), [false, false, true]);
  assert.deepEqual(["fullset", "digital", "physical"].map((k) => canSellKind(split, "b", k)), [false, true, false]);
  assert.equal(canSellKind({ is_ungraded: 1, physical_owner_id: "a", digital_owner_id: "a" }, "a", "fullset"), false);
  const pe = (v) => (v === "12,50" ? { ok: true, cents: 1250 } : { ok: false, error: "x" });
  assert.deepEqual(parseMarketPrice({ price_digital_cents: 500 }, "digital", pe), { present: true, ok: true, cents: 500 });
  assert.deepEqual(parseMarketPrice({ price_digital_cents: null }, "digital", pe), { present: true, ok: true, cents: null });
  assert.equal(parseMarketPrice({ price_digital_cents: 1.5 }, "digital", pe).ok, false);
  assert.equal(parseMarketPrice({ price_digital_euros: "12,50" }, "digital", pe).cents, 1250);
  assert.equal(parseMarketPrice({}, "digital", pe).present, false);
  assert.equal(normalizeCertQuery(" psa-1234 5678 "), "12345678");
  assert.equal(normalizeCertQuery("PSA 12345678"), "12345678");
  assert.equal(normalizeCertQuery("BGS-12345678"), "12345678");
  assert.equal(normalizeCertQuery("cgc 123"), "CGC123"); // remainder too short: keep compacted form
  assert.equal(normalizeCertQuery("cgc 123456"), "123456");
  assert.equal(normalizeCertQuery("12345678"), "12345678");
  assert.deepEqual(certSearchValues("PSA 12345678").sort(), ["12345678", "PSA12345678"].sort());
  assert.deepEqual(certSearchValues("12345678"), ["12345678"]);
  assert.deepEqual(certSearchValues("a-b"), []);
  assert.equal(normalizeCertQuery("a-b"), null);
  assert.equal(normalizeCertQuery("<script>"), null);
});
