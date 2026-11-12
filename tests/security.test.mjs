import test from "node:test";
import assert from "node:assert/strict";
import { hit, IP_RULES, LOGIN_FAIL_RULES, assertLoginAllowed, recordLoginFailure } from "../functions/lib/rate-limit.js";
import { validateRestCaptureStrict, canShip } from "../functions/lib/paypal.js";

function fakeDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        bind(...a) {
          return {
            async first() {
              if (sql.startsWith("INSERT INTO rate_limits")) {
                const r = rows.get(a[0]) || { count: 0, expires_at: a[1] };
                r.count++; rows.set(a[0], r); return { count: r.count };
              }
              if (sql.startsWith("SELECT count FROM rate_limits")) return rows.get(a[0]) || null;
              return null;
            },
            async run() { return {}; }
          };
        }
      };
    }
  };
}

test("rate limit triggers at the threshold and resets in the next window", async () => {
  const env = { DB: fakeDb() };
  const rule = IP_RULES.find((r) => r.name === "signup");
  const t0 = 1_800_000_000 - (1_800_000_000 % rule.windowSec);
  let last;
  for (let i = 0; i < rule.limit + 1; i++) last = await hit(env, "ip-signup", "1.2.3.4", rule, t0 + 10);
  assert.equal(last.count, rule.limit + 1); // -> 429
  assert.ok(last.retryAfter > 0 && last.retryAfter <= rule.windowSec);
  const next = await hit(env, "ip-signup", "1.2.3.4", rule, t0 + rule.windowSec + 1);
  assert.equal(next.count, 1); // reset
});

test("login failures lock email+IP after 5, other IPs unaffected", async () => {
  const env = { DB: fakeDb() };
  const req = (ip) => ({ headers: { get: (k) => (k === "cf-connecting-ip" ? ip : null) } });
  for (let i = 0; i < LOGIN_FAIL_RULES[0].limit; i++) await recordLoginFailure(env, req("1.1.1.1"), "a@example.com");
  await assert.rejects(assertLoginAllowed(env, req("1.1.1.1"), "a@example.com"), (e) => e.status === 429 && e.retryAfter > 0);
  await assertLoginAllowed(env, req("2.2.2.2"), "a@example.com");
});

test("webhook proof must carry sale ref, amount, currency and matching payee", () => {
  const sale = { id: "s1", status: "accepted", total_cents: 1000, seller_paypal_email: "seller@example.com" };
  const ok = { status: "COMPLETED", customId: "s1", amount: "10.00", currency: "EUR", payeeEmail: "seller@example.com" };
  assert.equal(validateRestCaptureStrict(sale, ok).ok, true);
  assert.equal(validateRestCaptureStrict(sale, { ...ok, amount: null }).ok, false);
  assert.equal(validateRestCaptureStrict(sale, { ...ok, payeeEmail: "" }).ok, false);
  assert.equal(validateRestCaptureStrict(sale, { ...ok, payeeEmail: "evil@example.com" }).ok, false);
  assert.equal(validateRestCaptureStrict(sale, { ...ok, customId: "" }).ok, false);
  assert.equal(validateRestCaptureStrict(sale, { ...ok, amount: "1.00" }).ok, false);
  assert.equal(canShip("accepted"), false);
});

test("webhook: unconfigured, unsigned and invalid signature are all rejected", async () => {
  const { onRequest } = await import("../functions/api/[[path]].js");
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    calls.push(String(u));
    if (String(u).includes("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
    if (String(u).includes("verify-webhook-signature")) return new Response(JSON.stringify({ verification_status: "FAILURE" }), { status: 200 });
    return new Response("{}", { status: 500 });
  };
  const body = JSON.stringify({ event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "FAKE", custom_id: "s1" } });
  const sig = { "paypal-transmission-id": "x", "paypal-transmission-sig": "x", "paypal-cert-url": "https://api.paypal.com/c", "paypal-auth-algo": "SHA256withRSA", "paypal-transmission-time": "2026-11-12T00:00:00Z" };
  const mk = (h) => new Request("https://dreamint.it/api/paypal/webhook", { method: "POST", headers: { "content-type": "application/json", ...h }, body });
  const envBase = { DB: fakeDb(), PAYPAL_AUTO: "wps", PAYPAL_ENV: "sandbox" };
  try {
    let r = await onRequest({ request: mk({}), env: envBase });
    assert.equal(r.status, 400); // wps mode: webhook off
    const rest = { ...envBase, PAYPAL_AUTO: "", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "sec" };
    r = await onRequest({ request: mk(sig), env: rest });
    assert.equal(r.status, 400); // no WEBHOOK_ID
    r = await onRequest({ request: mk({}), env: { ...rest, PAYPAL_WEBHOOK_ID: "wh" } });
    assert.equal(r.status, 400); // unsigned
    r = await onRequest({ request: mk(sig), env: { ...rest, PAYPAL_WEBHOOK_ID: "wh" } });
    assert.equal(r.status, 400); // invalid signature
    assert.ok(calls.some((c) => c.includes("verify-webhook-signature")));
    assert.ok(!calls.some((c) => c.includes("/v2/payments/captures/")));
  } finally {
    globalThis.fetch = realFetch;
  }
});
