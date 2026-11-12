import { payableCents } from "./shipping.js";

const CODE_RE = /^[A-Z0-9]{3,20}$/;

export function normalizePartnerCode(raw) {
  return String(raw || "").trim().toUpperCase().replace(/[\s_-]+/g, "");
}

export function isValidPartnerCode(code) {
  return CODE_RE.test(code);
}

export function partnerQuotaCents(volumeCents) {
  const v = Number(volumeCents) || 0;
  if (v <= 0) return 0;
  return Math.round(v * 0.01);
}

export function saleVolumeCents(sale) {
  return payableCents(sale);
}

export function buildShareUrl(origin, code) {
  const base = String(origin || "").replace(/\/$/, "");
  return base + "/?ref=" + encodeURIComponent(code);
}

export function buildStatsPath(token) {
  return "#/partner/" + String(token || "");
}

export function buildStatsUrl(origin, token) {
  const base = String(origin || "").replace(/\/$/, "");
  return base + "/" + buildStatsPath(token);
}

export function presentAdminPartner(p, origin) {
  const volume = Number(p.volume_cents) || 0;
  const quota = partnerQuotaCents(volume);
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    contact_note: p.contact_note || "",
    created_at: p.created_at,
    signup_count: Number(p.signup_count) || 0,
    sales_count: Number(p.sales_count) || 0,
    volume_cents: volume,
    quota_cents: quota,
    share_url: buildShareUrl(origin, p.code),
    stats_url: buildStatsUrl(origin, p.token)
  };
}

export function presentPublicPartnerStats(p) {
  const volume = Number(p.volume_cents) || 0;
  return {
    name: p.name,
    code: p.code,
    signup_count: Number(p.signup_count) || 0,
    sales_count: Number(p.sales_count) || 0,
    volume_cents: volume,
    quota_cents: partnerQuotaCents(volume),
    quota_label: "Quota potenziale partner = 1% del volume",
    payout_note: "nessun pagamento durante la beta"
  };
}

export const PARTNER_STATS_SQL = `
SELECT p.id, p.name, p.code, p.contact_note, p.token, p.created_at, p.created_by,
  (SELECT COUNT(*) FROM users u WHERE u.referred_by_partner_id = p.id) AS signup_count,
  (SELECT COUNT(*) FROM sales s
    WHERE s.status = 'completed'
      AND EXISTS (
        SELECT 1 FROM users u
        WHERE u.referred_by_partner_id = p.id
          AND (u.id = s.buyer_id OR u.id = s.seller_id)
      )
  ) AS sales_count,
  (SELECT COALESCE(SUM(
      CASE WHEN s.total_cents IS NOT NULL AND s.total_cents > 0
           THEN s.total_cents
           ELSE COALESCE(s.price_cents, 0) + COALESCE(s.shipping_cents, 0) + COALESCE(s.insurance_cents, 0)
      END
    ), 0)
   FROM sales s
   WHERE s.status = 'completed'
     AND EXISTS (
       SELECT 1 FROM users u
       WHERE u.referred_by_partner_id = p.id
         AND (u.id = s.buyer_id OR u.id = s.seller_id)
     )
  ) AS volume_cents
FROM partners p
`;
