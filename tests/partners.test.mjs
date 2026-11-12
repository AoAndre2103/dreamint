import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePartnerCode,
  isValidPartnerCode,
  partnerQuotaCents,
  saleVolumeCents,
  buildShareUrl,
  buildStatsPath,
  buildStatsUrl,
  presentAdminPartner,
  presentPublicPartnerStats
} from "../functions/lib/partners.js";

test("normalizes and validates partner codes", () => {
  assert.equal(normalizePartnerCode(" gengar-shop "), "GENGARSHOP");
  assert.equal(normalizePartnerCode("Gengar_Shop"), "GENGARSHOP");
  assert.equal(isValidPartnerCode("GENGARSHOP"), true);
  assert.equal(isValidPartnerCode("AB"), false);
  assert.equal(isValidPartnerCode("TOO-LONG-CODE-OVER-20CH"), false);
  assert.equal(isValidPartnerCode("bad!"), false);
  assert.equal(isValidPartnerCode(normalizePartnerCode("gengarshop")), true);
});

test("quota is 1% of transaction volume, rounded to cents", () => {
  assert.equal(partnerQuotaCents(0), 0);
  assert.equal(partnerQuotaCents(10000), 100);
  assert.equal(partnerQuotaCents(7723), 77);
  assert.equal(saleVolumeCents({ price_cents: 1000, shipping_cents: 499, insurance_cents: 0 }), 1499);
  assert.equal(saleVolumeCents({ price_cents: 1000, shipping_cents: 765, insurance_cents: 300, total_cents: 2065 }), 2065);
});

test("share URLs use the current origin so the domain can change", () => {
  assert.equal(buildShareUrl("https://gemint-beta.pages.dev/", "GENGARSHOP"), "https://gemint-beta.pages.dev/?ref=GENGARSHOP");
  assert.equal(buildShareUrl("https://dreamint.it", "GENGARSHOP"), "https://dreamint.it/?ref=GENGARSHOP");
  assert.equal(buildStatsPath("tok123"), "#/partner/tok123");
  assert.equal(buildStatsUrl("https://dreamint.it/", "tok123"), "https://dreamint.it/#/partner/tok123");
});

test("admin presentation includes links; public stats hide contacts and token", () => {
  const row = {
    id: "p1",
    name: "Gengar Shop",
    code: "GENGARSHOP",
    contact_note: "mario@shop.example",
    token: "secret-token-value",
    created_at: "2026-11-10T00:00:00Z",
    signup_count: 3,
    sales_count: 2,
    volume_cents: 20000
  };
  const admin = presentAdminPartner(row, "https://gemint-beta.pages.dev");
  assert.equal(admin.share_url, "https://gemint-beta.pages.dev/?ref=GENGARSHOP");
  assert.equal(admin.stats_url, "https://gemint-beta.pages.dev/#/partner/secret-token-value");
  assert.equal(admin.quota_cents, 200);
  assert.equal(admin.contact_note, "mario@shop.example");

  const pub = presentPublicPartnerStats(row);
  assert.equal(pub.name, "Gengar Shop");
  assert.equal(pub.quota_cents, 200);
  assert.equal(pub.quota_label, "Quota potenziale partner = 1% del volume");
  assert.equal(pub.payout_note, "nessun pagamento durante la beta");
  assert.equal("token" in pub, false);
  assert.equal("contact_note" in pub, false);
  assert.equal("stats_url" in pub, false);
  assert.deepEqual(Object.keys(pub).sort(), [
    "code", "name", "payout_note", "quota_cents", "quota_label",
    "sales_count", "signup_count", "volume_cents"
  ]);
});
