import test from "node:test";
import assert from "node:assert/strict";
import {
  INSURANCE_CENTS,
  parseShippingChoice,
  trackingUrl,
  formatDestText,
  payableCents,
  publicShippingConfig
} from "../functions/lib/shipping.js";

test("public config exposes the three fixed methods and insurance", () => {
  const cfg = publicShippingConfig();
  assert.equal(cfg.insurance_cents, 300);
  assert.equal(cfg.methods.length, 3);
  assert.deepEqual(cfg.methods.map((m) => m.id), ["inpost_locker", "poste_punto", "poste_home"]);
  assert.equal(cfg.methods[0].price_cents, 499);
  assert.equal(cfg.methods[1].price_cents, 565);
  assert.equal(cfg.methods[2].price_cents, 765);
});

test("InPost locker requires destination code and rejects insurance", () => {
  const ok = parseShippingChoice({
    shipping_method: "inpost_locker",
    shipping_dest: { name: "Mario Rossi", phone: "3331234567", point_code: "RM001" }
  }, 2500);
  assert.equal(ok.ok, true);
  assert.equal(ok.shipping_cents, 499);
  assert.equal(ok.insurance, 0);
  assert.equal(ok.total_cents, 2500 + 499);

  const noCode = parseShippingChoice({
    shipping_method: "inpost_locker",
    shipping_dest: { name: "Mario Rossi", phone: "3331234567" }
  }, 2500);
  assert.equal(noCode.ok, false);

  const insured = parseShippingChoice({
    shipping_method: "inpost_locker",
    insurance: true,
    shipping_dest: { name: "Mario Rossi", phone: "3331234567", point_code: "RM001" }
  }, 2500);
  assert.equal(insured.ok, false);
});

test("Poste home + insurance totals price + 7.65 + 3.00", () => {
  const ok = parseShippingChoice({
    shipping_method: "poste_home",
    insurance: true,
    shipping_dest: { name: "Anna Bianchi", phone: "+393331234567", address: "Via Roma 1", city: "Roma", zip: "00100", province: "RM" }
  }, 1000);
  assert.equal(ok.ok, true);
  assert.equal(ok.shipping_cents, 765);
  assert.equal(ok.insurance_cents, INSURANCE_CENTS);
  assert.equal(ok.total_cents, 1000 + 765 + 300);
});

test("missing method or invalid phone is rejected", () => {
  assert.equal(parseShippingChoice({}, 1000).ok, false);
  const badPhone = parseShippingChoice({
    shipping_method: "poste_punto",
    shipping_dest: { name: "Luca", phone: "12", point_code: "PP123" }
  }, 1000);
  assert.equal(badPhone.ok, false);
});

test("tracking URLs are official InPost and Poste links", () => {
  assert.equal(
    trackingUrl("inpost_locker", "ABC 123"),
    "https://inpost.it/trova-il-tuo-pacco?number=ABC123"
  );
  assert.equal(
    trackingUrl("poste_home", "BD123456789IT"),
    "https://www.poste.it/cerca/index.html#/risultati-spedizioni/BD123456789IT"
  );
  assert.equal(trackingUrl("poste_punto", ""), "");
});

test("payableCents prefers stored total", () => {
  assert.equal(payableCents({ price_cents: 1000, shipping_cents: 499, insurance_cents: 0, total_cents: 1499 }), 1499);
  assert.equal(payableCents({ price_cents: 1000, shipping_cents: 765, insurance_cents: 300 }), 2065);
});

test("formatDestText includes name, phone and point or address", () => {
  const locker = formatDestText({ name: "Mario", phone: "333", point_code: "RM1" }, "inpost_locker");
  assert.match(locker, /Mario/);
  assert.match(locker, /RM1/);
  const home = formatDestText({ name: "Anna", address: "Via Roma 1", zip: "00100", city: "Roma", province: "RM" }, "poste_home");
  assert.match(home, /Via Roma 1/);
  assert.match(home, /00100 Roma RM/);
});

import { publicShippingConfig as _psc } from "../functions/lib/shipping.js";
test("carrier finder URLs are the verified official pages (no 404)", () => {
  const all = JSON.stringify(_psc());
  assert.ok(all.includes("https://inpost.it/trova-un-locker"));
  assert.ok(all.includes("https://www.poste.it/prenotazione/vieni-in-poste"));
  assert.ok(!all.includes("trova-locker\"") && !all.includes("nuovo-cerca-uffici"));
});
