/** Fixed Vinted-style shipping options. The platform never buys labels. */

export const INSURANCE_CENTS = 300;
export const INSURANCE_COVER_CENTS = 300000;

export const SHIPPING_METHODS = {
  inpost_locker: {
    id: "inpost_locker",
    carrier: "inpost",
    label: "InPost locker → locker",
    shortLabel: "InPost locker",
    price_cents: 499,
    insuranceAllowed: false,
    destType: "locker",
    pointLabel: "Codice locker InPost",
    pointHint: "Codice del locker di destinazione, visibile sul sito InPost.",
    finderUrl: "https://inpost.it/trova-un-locker",
    finderLabel: "Trova un locker InPost",
    labelUrl: "https://inpost.it/direct/it",
    labelLabel: "Crea l’etichetta su InPost Direct"
  },
  poste_punto: {
    id: "poste_punto",
    carrier: "poste",
    label: "Poste Delivery Web Punto Poste → Punto Poste",
    shortLabel: "Punto Poste",
    price_cents: 565,
    insuranceAllowed: true,
    destType: "punto_poste",
    pointLabel: "Codice Punto Poste",
    pointHint: "Codice del Punto Poste di destinazione (tabaccaio, bar o locker).",
    finderUrl: "https://www.poste.it/prenotazione/vieni-in-poste",
    finderLabel: "Trova un Punto Poste",
    labelUrl: "https://postedeliveryweb-retail.poste.it/paccoweb/",
    labelLabel: "Crea l’etichetta su Poste Delivery Web"
  },
  poste_home: {
    id: "poste_home",
    carrier: "poste",
    label: "Poste consegna a domicilio",
    shortLabel: "Poste a domicilio",
    price_cents: 765,
    insuranceAllowed: true,
    destType: "address",
    pointLabel: "",
    pointHint: "",
    finderUrl: "",
    finderLabel: "",
    labelUrl: "https://postedeliveryweb-retail.poste.it/paccoweb/",
    labelLabel: "Crea l’etichetta su Poste Delivery Web"
  }
};

export function publicShippingConfig() {
  return {
    insurance_cents: INSURANCE_CENTS,
    insurance_cover_cents: INSURANCE_COVER_CENTS,
    methods: Object.values(SHIPPING_METHODS).map((m) => ({
      id: m.id,
      carrier: m.carrier,
      label: m.label,
      shortLabel: m.shortLabel,
      price_cents: m.price_cents,
      insuranceAllowed: m.insuranceAllowed,
      destType: m.destType,
      pointLabel: m.pointLabel,
      pointHint: m.pointHint,
      finderUrl: m.finderUrl,
      finderLabel: m.finderLabel
    }))
  };
}

export function getShippingMethod(id) {
  return SHIPPING_METHODS[String(id || "")] || null;
}

export function payableCents(sale) {
  if (!sale) return 0;
  const total = Number(sale.total_cents);
  if (Number.isFinite(total) && total > 0) return total;
  const price = Number(sale.price_cents) || 0;
  const shipping = Number(sale.shipping_cents) || 0;
  const insurance = Number(sale.insurance_cents) || 0;
  return price + shipping + insurance;
}

function cleanText(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function phoneDigits(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

export function isValidPhone(value) {
  const digits = phoneDigits(value);
  if (digits.startsWith("39") && digits.length >= 11 && digits.length <= 13) return true;
  return digits.length >= 9 && digits.length <= 13;
}

export function trackingUrl(methodId, code) {
  const tracking = cleanText(code, 120).replace(/\s+/g, "");
  if (!tracking) return "";
  const method = getShippingMethod(methodId);
  if (!method) return "";
  if (method.carrier === "inpost") {
    return "https://inpost.it/trova-il-tuo-pacco?number=" + encodeURIComponent(tracking);
  }
  if (method.carrier === "poste") {
    return "https://www.poste.it/cerca/index.html#/risultati-spedizioni/" + encodeURIComponent(tracking);
  }
  return "";
}

export function parseShippingChoice(body, priceCents) {
  const method = getShippingMethod(body && body.shipping_method);
  if (!method) {
    return { ok: false, error: "Scegli un metodo di spedizione tracciato" };
  }
  const wantInsurance = !!(body && (body.insurance === true || body.insurance === 1 || body.insurance === "1" || body.insurance === "true"));
  if (wantInsurance && !method.insuranceAllowed) {
    return { ok: false, error: "L’assicurazione da 3,00 € è disponibile solo sulle spedizioni Poste, fino a 3.000 €" };
  }
  const destIn = (body && (body.shipping_dest || body.dest)) || body || {};
  const dest = {
    name: cleanText(destIn.name || destIn.ship_name, 80),
    phone: cleanText(destIn.phone || destIn.ship_phone, 30)
  };
  if (!dest.name) return { ok: false, error: "Inserisci il nome del destinatario" };
  if (!isValidPhone(dest.phone)) return { ok: false, error: "Inserisci un numero di telefono valido del destinatario" };

  if (method.destType === "locker" || method.destType === "punto_poste") {
    dest.point_code = cleanText(destIn.point_code || destIn.ship_point_code || destIn.code, 40);
    if (!dest.point_code || dest.point_code.length < 3) {
      return { ok: false, error: "Inserisci il " + method.pointLabel.toLowerCase() };
    }
  } else {
    dest.address = cleanText(destIn.address || destIn.ship_address, 120);
    dest.city = cleanText(destIn.city || destIn.ship_city, 60);
    dest.zip = cleanText(destIn.zip || destIn.ship_zip || destIn.cap, 8).replace(/\s+/g, "");
    dest.province = cleanText(destIn.province || destIn.ship_province, 4).toUpperCase();
    if (!dest.address) return { ok: false, error: "Inserisci l’indirizzo di consegna" };
    if (!/^\d{5}$/.test(dest.zip)) return { ok: false, error: "Inserisci un CAP di 5 cifre" };
    if (!dest.city) return { ok: false, error: "Inserisci la città" };
    if (!/^[A-Z]{2}$/.test(dest.province)) return { ok: false, error: "Inserisci la provincia (due lettere, es. RM)" };
  }

  const insurance_cents = wantInsurance ? INSURANCE_CENTS : 0;
  const price = Number(priceCents) || 0;
  return {
    ok: true,
    method_id: method.id,
    shipping_cents: method.price_cents,
    insurance: wantInsurance ? 1 : 0,
    insurance_cents,
    total_cents: price + method.price_cents + insurance_cents,
    dest,
    dest_json: JSON.stringify(dest)
  };
}

export function parseDest(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

export function formatDestText(dest, methodId) {
  const d = parseDest(dest);
  if (!d) return "";
  const method = getShippingMethod(methodId);
  const lines = [];
  if (d.name) lines.push("Nome: " + d.name);
  if (d.phone) lines.push("Telefono: " + d.phone);
  if (d.point_code) lines.push((method && method.pointLabel ? method.pointLabel : "Punto") + ": " + d.point_code);
  if (d.address) lines.push("Indirizzo: " + d.address);
  if (d.zip || d.city || d.province) {
    lines.push([d.zip, d.city, d.province].filter(Boolean).join(" "));
  }
  return lines.join("\n");
}

export function canSeeShippingDest(sale, viewer) {
  if (!sale || !viewer) return false;
  if (!["paid", "shipped", "completed"].includes(sale.status)) return false;
  return viewer.role === "admin" || viewer.id === sale.seller_id;
}

export function presentShipping(sale, viewer) {
  const method = getShippingMethod(sale && sale.shipping_method);
  const insurance = Number((sale && sale.insurance) || 0) ? 1 : 0;
  const shipping_cents = Number((sale && sale.shipping_cents) || 0);
  const insurance_cents = Number((sale && sale.insurance_cents) || 0);
  const out = {
    shipping_method: (sale && sale.shipping_method) || null,
    shipping_label: method ? method.label : null,
    shipping_short_label: method ? method.shortLabel : null,
    shipping_carrier: method ? method.carrier : null,
    shipping_cents,
    insurance,
    insurance_cents,
    insurance_cover_cents: INSURANCE_COVER_CENTS,
    total_cents: payableCents(sale),
    tracking: (sale && sale.tracking) || "",
    tracking_url: (sale && sale.tracking_url) || trackingUrl(sale && sale.shipping_method, sale && sale.tracking)
  };
  if (method) {
    out.label_url = method.labelUrl;
    out.label_label = method.labelLabel;
  }
  if (canSeeShippingDest(sale, viewer)) {
    out.shipping_dest = parseDest(sale.shipping_dest);
    out.shipping_dest_text = formatDestText(sale.shipping_dest, sale.shipping_method);
  }
  return out;
}

export function publicShippingChoice(sale) {
  const method = getShippingMethod(sale && sale.shipping_method);
  return {
    shipping_method: (sale && sale.shipping_method) || null,
    shipping_label: method ? method.label : null,
    shipping_short_label: method ? method.shortLabel : null,
    shipping_cents: Number((sale && sale.shipping_cents) || 0),
    insurance: Number((sale && sale.insurance) || 0) ? 1 : 0,
    insurance_cents: Number((sale && sale.insurance_cents) || 0),
    total_cents: payableCents(sale)
  };
}
