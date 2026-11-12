/** Pure PayPal helpers — no P.IVA required for WPS+IPN path. */

export function paypalMode(env) {
  const flag = String((env && env.PAYPAL_AUTO) || "").toLowerCase();
  if (flag === "off" || flag === "manual" || flag === "0") return "manual";
  if (env && env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) return "rest";
  return "wps";
}

export function paypalEnvName(env) {
  const v = String((env && env.PAYPAL_ENV) || "live").toLowerCase();
  return v === "sandbox" ? "sandbox" : "live";
}

export function paypalApiBase(env) {
  return paypalEnvName(env) === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

export function paypalWebBase(env) {
  return paypalEnvName(env) === "sandbox"
    ? "https://www.sandbox.paypal.com"
    : "https://www.paypal.com";
}

export function ipnVerifyUrl(env) {
  return paypalEnvName(env) === "sandbox"
    ? "https://ipnpb.sandbox.paypal.com/cgi-bin/webscr"
    : "https://ipnpb.paypal.com/cgi-bin/webscr";
}

export function isValidPaypalEmail(value) {
  const s = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 127;
}

export function eurosFromCents(cents) {
  return (Number(cents) / 100).toFixed(2);
}

export function buildWpsCheckoutUrl(opts) {
  const env = opts.env || {};
  const params = new URLSearchParams({
    cmd: "_xclick",
    business: String(opts.sellerEmail || "").trim(),
    item_name: String(opts.itemName || "Carta DreaMint").slice(0, 127),
    item_number: String(opts.saleId || "").slice(0, 127),
    invoice: String(opts.saleId || "").slice(0, 127),
    custom: String(opts.saleId || "").slice(0, 256),
    amount: eurosFromCents(opts.amountCents),
    currency_code: opts.currency || "EUR",
    no_shipping: "1",
    no_note: "1",
    charset: "utf-8",
    rm: "2",
    paymentaction: "sale"
  });
  if (opts.returnUrl) params.set("return", opts.returnUrl);
  if (opts.cancelUrl) params.set("cancel_return", opts.cancelUrl);
  if (opts.notifyUrl) params.set("notify_url", opts.notifyUrl);
  return paypalWebBase(env) + "/cgi-bin/webscr?" + params.toString();
}

export function buildOrdersCreateBody(opts) {
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        custom_id: String(opts.saleId || ""),
        invoice_id: String(opts.saleId || ""),
        description: String(opts.itemName || "Carta DreaMint").slice(0, 127),
        amount: {
          currency_code: opts.currency || "EUR",
          value: eurosFromCents(opts.amountCents)
        },
        payee: {
          email_address: String(opts.sellerEmail || "").trim()
        }
      }
    ],
    application_context: {
      shipping_preference: "NO_SHIPPING",
      user_action: "PAY_NOW",
      brand_name: "DreaMint",
      return_url: opts.returnUrl || undefined,
      cancel_url: opts.cancelUrl || undefined
    }
  };
}

export function parseFormBody(raw) {
  const out = {};
  const params = new URLSearchParams(String(raw || ""));
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

export function payableCents(sale) {
  if (!sale) return 0;
  const total = Number(sale.total_cents);
  if (Number.isFinite(total) && total > 0) return total;
  return (Number(sale.price_cents) || 0)
    + (Number(sale.shipping_cents) || 0)
    + (Number(sale.insurance_cents) || 0);
}

export function amountsMatch(saleCents, paid, currency) {
  if (String(currency || "EUR").toUpperCase() !== "EUR") return false;
  const got = Math.round(parseFloat(String(paid).replace(",", ".")) * 100);
  if (!Number.isFinite(got)) return false;
  return Math.abs(got - Number(saleCents)) <= 1;
}

export function canMarkPaid(status) {
  return status === "requested" || status === "accepted";
}

// SECURITY (M1): ship only after a confirmed payment (IPN/REST verified or seller-confirmed).
export function canShip(status) {
  return status === "paid";
}

export function validateIpnPayment(sale, ipn) {
  if (!sale) return { ok: false, reason: "Vendita non trovata" };
  if (String(ipn.payment_status || "") !== "Completed") {
    return { ok: false, reason: "Pagamento non completato" };
  }
  const saleId = String(ipn.invoice || ipn.custom || ipn.item_number || "");
  if (saleId && saleId !== sale.id) return { ok: false, reason: "Riferimento vendita non valido" };
  const receiver = String(ipn.receiver_email || ipn.business || "").trim().toLowerCase();
  const expected = String(sale.seller_paypal_email || "").trim().toLowerCase();
  if (!expected || receiver !== expected) return { ok: false, reason: "Destinatario PayPal non corrispondente" };
  if (!amountsMatch(payableCents(sale), ipn.mc_gross, ipn.mc_currency)) {
    return { ok: false, reason: "Importo o valuta non corrispondenti" };
  }
  if (!canMarkPaid(sale.status) && sale.status !== "paid") {
    return { ok: false, reason: "Stato vendita non pagabile" };
  }
  return { ok: true };
}

export function shouldAutoComplete(sale, nowMs, days) {
  if (!sale || sale.status !== "shipped" || !sale.shipped_at) return false;
  const shipped = Date.parse(sale.shipped_at);
  if (!Number.isFinite(shipped)) return false;
  const wait = (Number(days) || 14) * 86400000;
  return nowMs >= shipped + wait;
}

export function extractCaptureFromOrder(order) {
  const units = (order && order.purchase_units) || [];
  const cap = ((((units[0] || {}).payments || {}).captures) || [])[0] || {};
  const payee = (units[0] || {}).payee || {};
  return {
    status: cap.status || order.status,
    captureId: cap.id || "",
    orderId: order.id || "",
    amount: cap.amount && cap.amount.value,
    currency: cap.amount && cap.amount.currency_code,
    payeeEmail: payee.email_address || "",
    customId: units[0] && units[0].custom_id,
    invoiceId: units[0] && units[0].invoice_id
  };
}

export function validateRestCapture(sale, extracted) {
  if (!sale) return { ok: false, reason: "Vendita non trovata" };
  if (String(extracted.status || "").toUpperCase() !== "COMPLETED") {
    return { ok: false, reason: "Capture non completata" };
  }
  const ref = String(extracted.customId || extracted.invoiceId || "");
  if (ref && ref !== sale.id) return { ok: false, reason: "Riferimento vendita non valido" };
  const receiver = String(extracted.payeeEmail || "").trim().toLowerCase();
  const expected = String(sale.seller_paypal_email || "").trim().toLowerCase();
  if (receiver && expected && receiver !== expected) {
    return { ok: false, reason: "Destinatario PayPal non corrispondente" };
  }
  if (extracted.amount != null && !amountsMatch(payableCents(sale), extracted.amount, extracted.currency || "EUR")) {
    return { ok: false, reason: "Importo o valuta non corrispondenti" };
  }
  if (!canMarkPaid(sale.status) && sale.status !== "paid") {
    return { ok: false, reason: "Stato vendita non pagabile" };
  }
  return { ok: true };
}

// SECURITY (A1): webhook/REST proofs must carry reference, amount, currency and payee.
export function validateRestCaptureStrict(sale, extracted) {
  if (!sale) return { ok: false, reason: "Vendita non trovata" };
  const ref = String(extracted.customId || extracted.invoiceId || "");
  if (!ref || ref !== sale.id) return { ok: false, reason: "Riferimento vendita mancante o non valido" };
  if (extracted.amount == null || !extracted.currency) return { ok: false, reason: "Importo o valuta mancanti" };
  const receiver = String(extracted.payeeEmail || "").trim().toLowerCase();
  const expected = String(sale.seller_paypal_email || "").trim().toLowerCase();
  if (!receiver || !expected || receiver !== expected) return { ok: false, reason: "Destinatario PayPal non corrispondente" };
  return validateRestCapture(sale, extracted);
}

export function publicPaypalConfig(env) {
  const mode = paypalMode(env);
  return {
    mode,
    env: paypalEnvName(env),
    clientId: mode === "rest" ? env.PAYPAL_CLIENT_ID : "",
    autoCompleteDays: Number(env.PAYPAL_AUTOCOMPLETE_DAYS || 14)
  };
}
