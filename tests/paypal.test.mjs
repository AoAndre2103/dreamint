import test from "node:test";
import assert from "node:assert/strict";
import {
  paypalMode,
  paypalEnvName,
  paypalApiBase,
  paypalWebBase,
  ipnVerifyUrl,
  isValidPaypalEmail,
  eurosFromCents,
  buildWpsCheckoutUrl,
  buildOrdersCreateBody,
  parseFormBody,
  amountsMatch,
  canMarkPaid,
  canShip,
  validateIpnPayment,
  validateRestCapture,
  shouldAutoComplete,
  extractCaptureFromOrder,
  publicPaypalConfig
} from "../functions/lib/paypal.js";

test("mode: no creds defaults to wps (automatic without P.IVA)", () => {
  assert.equal(paypalMode({}), "wps");
  assert.equal(paypalMode({ PAYPAL_AUTO: "off" }), "manual");
  assert.equal(paypalMode({ PAYPAL_AUTO: "manual" }), "manual");
  assert.equal(paypalMode({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "sec" }), "rest");
});

test("env endpoints", () => {
  assert.equal(paypalEnvName({}), "live");
  assert.equal(paypalApiBase({ PAYPAL_ENV: "sandbox" }), "https://api-m.sandbox.paypal.com");
  assert.equal(paypalWebBase({}), "https://www.paypal.com");
  assert.equal(ipnVerifyUrl({ PAYPAL_ENV: "sandbox" }), "https://ipnpb.sandbox.paypal.com/cgi-bin/webscr");
});

test("email validation", () => {
  assert.equal(isValidPaypalEmail("seller@example.com"), true);
  assert.equal(isValidPaypalEmail("not-an-email"), false);
  assert.equal(isValidPaypalEmail(""), false);
});

test("WPS checkout url pays the seller and includes IPN notify_url", () => {
  const url = buildWpsCheckoutUrl({
    env: { PAYPAL_ENV: "sandbox" },
    sellerEmail: "seller@example.com",
    saleId: "sale-1",
    amountCents: 1250,
    itemName: "Charizard PSA 10",
    returnUrl: "https://gemint.example/#/vendite",
    cancelUrl: "https://gemint.example/#/vendite",
    notifyUrl: "https://gemint.example/api/paypal/ipn"
  });
  assert.match(url, /^https:\/\/www\.sandbox\.paypal\.com\/cgi-bin\/webscr\?/);
  const q = new URL(url).searchParams;
  assert.equal(q.get("cmd"), "_xclick");
  assert.equal(q.get("business"), "seller@example.com");
  assert.equal(q.get("amount"), "12.50");
  assert.equal(q.get("currency_code"), "EUR");
  assert.equal(q.get("invoice"), "sale-1");
  assert.equal(q.get("custom"), "sale-1");
  assert.equal(q.get("notify_url"), "https://gemint.example/api/paypal/ipn");
  assert.equal(q.get("paymentaction"), "sale");
});

test("Orders v2 body uses CAPTURE and payee = seller", () => {
  const body = buildOrdersCreateBody({
    sellerEmail: "seller@example.com",
    saleId: "sale-9",
    amountCents: 9900,
    itemName: "Luffy",
    returnUrl: "https://x/ok",
    cancelUrl: "https://x/no"
  });
  assert.equal(body.intent, "CAPTURE");
  assert.equal(body.purchase_units[0].payee.email_address, "seller@example.com");
  assert.equal(body.purchase_units[0].amount.value, "99.00");
  assert.equal(body.purchase_units[0].custom_id, "sale-9");
  assert.ok(!("platform_fees" in (body.purchase_units[0] || {})));
});

test("IPN validation accepts matching completed payment", () => {
  const sale = {
    id: "sale-1",
    status: "requested",
    price_cents: 1250,
    seller_paypal_email: "Seller@Example.com"
  };
  const ipn = parseFormBody(
    "payment_status=Completed&mc_gross=12.50&mc_currency=EUR&receiver_email=seller@example.com&invoice=sale-1&txn_id=TX1"
  );
  assert.equal(validateIpnPayment(sale, ipn).ok, true);
});

test("IPN validation rejects wrong payee, amount, or status", () => {
  const sale = { id: "sale-1", status: "requested", price_cents: 1250, seller_paypal_email: "seller@example.com" };
  assert.equal(validateIpnPayment(sale, { payment_status: "Pending", mc_gross: "12.50", mc_currency: "EUR", receiver_email: "seller@example.com", invoice: "sale-1" }).ok, false);
  assert.equal(validateIpnPayment(sale, { payment_status: "Completed", mc_gross: "10.00", mc_currency: "EUR", receiver_email: "seller@example.com", invoice: "sale-1" }).ok, false);
  assert.equal(validateIpnPayment(sale, { payment_status: "Completed", mc_gross: "12.50", mc_currency: "EUR", receiver_email: "other@example.com", invoice: "sale-1" }).ok, false);
});

test("REST capture extract + validate from mocked Orders API payload", () => {
  const order = {
    id: "ORDER-1",
    status: "COMPLETED",
    purchase_units: [{
      custom_id: "sale-1",
      invoice_id: "sale-1",
      payee: { email_address: "seller@example.com" },
      payments: {
        captures: [{ id: "CAP-1", status: "COMPLETED", amount: { value: "12.50", currency_code: "EUR" } }]
      }
    }]
  };
  const extracted = extractCaptureFromOrder(order);
  const sale = { id: "sale-1", status: "accepted", price_cents: 1250, seller_paypal_email: "seller@example.com" };
  assert.equal(extracted.captureId, "CAP-1");
  assert.equal(validateRestCapture(sale, extracted).ok, true);
});

test("status helpers and auto-complete after X days", () => {
  assert.equal(canMarkPaid("requested"), true);
  assert.equal(canMarkPaid("shipped"), false);
  assert.equal(canShip("paid"), true);
  assert.equal(canShip("requested"), false);
  const shipped = { status: "shipped", shipped_at: "2026-01-01T00:00:00.000Z" };
  assert.equal(shouldAutoComplete(shipped, Date.parse("2026-01-10T00:00:00.000Z"), 14), false);
  assert.equal(shouldAutoComplete(shipped, Date.parse("2026-01-16T00:00:00.000Z"), 14), true);
  assert.equal(eurosFromCents(5), "0.05");
  assert.equal(amountsMatch(1999, "19.99", "EUR"), true);
  const cfg = publicPaypalConfig({});
  assert.equal(cfg.mode, "wps");
  assert.equal(cfg.clientId, "");
});
