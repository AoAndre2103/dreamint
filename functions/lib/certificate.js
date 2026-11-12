/**
 * Digital certificates, transfer-by-code, off-platform claims, and public 3D share pages.
 * Handlers are wired from functions/api/[[path]].js and functions/c/[[path]].js.
 */

import { serialTotalFor } from "./mint-draw.js";
import { parseImageDataUrl, sanitizeImageDataUrl, sniffImageType, safeImageResponse } from "./image-safety.js";

const TIER_LABELS = {
  comune: "Comune",
  rara: "Rara",
  epica: "Epica",
  leggendaria: "Leggendaria",
  mitica: "Mitica"
};

const DISPUTE_DAYS = 7;
const MAX_FAILED_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_CLAIM_PHOTOS = 4;
const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;
const CANONICAL_ORIGIN = "https://dreamint.it";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function nowIso() {
  return new Date().toISOString();
}

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(corsHeaders || {})
    }
  });
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function attr(s) {
  return esc(s).replace(/`/g, "&#96;");
}

function siteOrigin(request) {
  try {
    const u = new URL(request.url);
    const host = (u.hostname || "").toLowerCase();
    if (host === "dreamint.it" || host === "www.dreamint.it") return CANONICAL_ORIGIN;
    if (host.endsWith(".gemint-beta.pages.dev") && host !== "gemint-beta.pages.dev") return u.origin;
  } catch (e) { /* ignore */ }
  return CANONICAL_ORIGIN;
}

function publicCopyUrl(request, slabId) {
  return siteOrigin(request) + "/c/" + encodeURIComponent(slabId);
}

function certPageUrl(request, slabId) {
  return siteOrigin(request) + "/#/certificato/" + encodeURIComponent(slabId);
}

function serialFmt(n, total) {
  if (n == null || n === "") return "";
  const left = "#" + String(n).padStart(4, "0");
  if (total == null || total === "") return left + " / ∞";
  let t = String(total);
  if (/^\d+$/.test(t)) t = t.padStart(4, "0");
  return left + " / " + t;
}

function normalizeCertNo(cert) {
  return String(cert || "").trim().toUpperCase().replace(/\s+/g, "");
}

function generateTransferCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let raw = "";
  for (let i = 0; i < bytes.length; i++) raw += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return "DM-" + raw.slice(0, 4) + "-" + raw.slice(4, 8) + "-" + raw.slice(8, 12);
}

function normalizeTransferCode(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function formatRomeDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("it-IT", {
      timeZone: "Europe/Rome",
      day: "2-digit",
      month: "long",
      year: "numeric"
    }).format(d);
  } catch (e) {
    return String(iso).slice(0, 10);
  }
}

function addDaysIso(iso, days) {
  const d = new Date(iso || Date.now());
  d.setTime(d.getTime() + days * 86400 * 1000);
  return d.toISOString();
}

async function loadCopyRow(env, id) {
  return env.DB.prepare(
    `SELECT s.*, m.game, m.set_name, m.code_printed, m.code_normalized, m.name AS card_name,
            m.language, m.variant, m.slug, m.catalog_image, c.registered_count,
            po.display_name AS physical_owner_name,
            do.display_name AS digital_owner_name,
            po.username AS physical_owner_username, po.album_public AS physical_owner_album_public,
            do.username AS digital_owner_username, do.album_public AS digital_owner_album_public,
            do.email AS digital_owner_email,
            po.email AS physical_owner_email
     FROM slabs s
     JOIN card_models m ON m.id = s.card_model_id
     LEFT JOIN card_model_counters c ON c.card_model_id = s.card_model_id
     LEFT JOIN users po ON po.id = s.physical_owner_id
     LEFT JOIN users do ON do.id = s.digital_owner_id
     WHERE s.id = ?`
  ).bind(id).first();
}

function hasDigitalCopy(slab) {
  return !!(slab && !slab.is_ungraded && slab.rarity_tier && slab.serial_number
    && slab.status !== "in_review" && slab.status !== "rejected");
}

function formatRomeDateTime(iso) {
  try {
    return new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) + " (ora italiana)";
  } catch (e) {
    return String(iso).slice(0, 16);
  }
}

// Anti-screenshot (v18): the CURRENT owners, read from the DB at request time. Only the username and
// only if that user's album is public; otherwise «Collezionista privato». Never e-mail / display_name.
export function publicOwnerLabel(username, albumPublic) {
  if (username && albumPublic) return { username, label: "@" + username, profile_url: "/#/u/" + encodeURIComponent(username), private: false };
  return { username: null, label: "Collezionista privato", profile_url: null, private: true };
}

function presentPublicCopy(slab, request) {
  const total = serialTotalFor(slab) || slab.serial_number;
  const digitalOwner = publicOwnerLabel(slab.digital_owner_username, slab.digital_owner_album_public);
  const physicalOwner = publicOwnerLabel(slab.physical_owner_username, slab.physical_owner_album_public);
  const checkedAt = new Date().toISOString();
  return {
    id: slab.id,
    name: slab.card_name,
    set_name: slab.set_name,
    code_printed: slab.code_printed,
    game: slab.game,
    language: slab.language,
    grader: slab.grader,
    grade: slab.grade,
    certificate_no: slab.certificate_no,
    rarity_tier: slab.rarity_tier,
    rarity_label: TIER_LABELS[slab.rarity_tier] || slab.rarity_tier,
    serial_number: slab.serial_number,
    serial_total: total,
    serial_label: serialFmt(slab.serial_number, total),
    assigned_at: slab.assigned_at,
    owner_name: digitalOwner.label,
    digital_owner: digitalOwner,
    physical_owner: physicalOwner,
    full_set: !!(slab.physical_owner_id && slab.physical_owner_id === slab.digital_owner_id),
    owner_checked_at: checkedAt,
    owner_checked_label: formatRomeDateTime(checkedAt),
    catalog_image: slab.catalog_image || null,
    is_test: !!slab.is_test,
    share_url: publicCopyUrl(request, slab.id),
    art_url: siteOrigin(request) + "/api/copies/" + encodeURIComponent(slab.id) + "/art"
  };
}

export async function makeTransferCode() {
  const code = generateTransferCode();
  const hash = await sha256Hex(normalizeTransferCode(code));
  return { code, hash, at: nowIso() };
}

// Hash update + reveal row for the current digital owner (call after the owner
// column has been updated in the same batch). Optional SQL guard binds last.
export function transferCodeRotateStmts(env, slabId, rotation, guardSql, guardBinds) {
  const { code, hash, at } = rotation;
  const guard = guardSql ? " AND " + guardSql : "";
  const gb = guardBinds || [];
  const onlyDigital = " AND s.is_ungraded = 0 AND s.serial_number IS NOT NULL AND s.digital_owner_id IS NOT NULL";
  return [
    env.DB.prepare(
      `UPDATE slabs SET transfer_code_hash = ?, transfer_code_created_at = ?
       WHERE id = ? AND is_ungraded = 0 AND serial_number IS NOT NULL` + guard
    ).bind(hash, at, slabId, ...gb),
    env.DB.prepare(
      `INSERT OR REPLACE INTO transfer_code_reveals (slab_id, user_id, code, created_at)
       SELECT ?, s.digital_owner_id, ?, ? FROM slabs s
       WHERE s.id = ?` + onlyDigital + guard
    ).bind(slabId, code, at, slabId, ...gb)
  ];
}

async function rotateTransferCode(env, slabId) {
  const rotation = await makeTransferCode();
  await env.DB.batch(transferCodeRotateStmts(env, slabId, rotation));
  return rotation.code;
}

export async function notifyDigitalOwnerTransferCode(env, request, helpers, slabId) {
  if (!helpers || !helpers.sendNotifyEmail || !request) return;
  const slab = await loadCopyRow(env, slabId);
  if (!hasDigitalCopy(slab) || !slab.digital_owner_email || !slab.digital_owner_id) return;
  const reveal = await env.DB.prepare(
    "SELECT code FROM transfer_code_reveals WHERE slab_id = ? AND user_id = ?"
  ).bind(slabId, slab.digital_owner_id).first();
  if (!reveal || !reveal.code) return;
  const copy = presentPublicCopy(slab, request);
  await emailCertificate(helpers, env, request, slab.digital_owner_email, copy, reveal.code);
}

async function findSlabByCert(env, certificateNo, grader) {
  const cert = normalizeCertNo(certificateNo);
  if (!cert) return { error: "Indica il numero di certificato", status: 400 };
  if (grader) {
    const row = await env.DB.prepare(
      "SELECT id FROM slabs WHERE certificate_no = ? AND grader = ? AND is_ungraded = 0"
    ).bind(cert, String(grader).trim().toUpperCase()).first();
    if (!row) return { error: "Nessuna copia digitale con questo certificato", status: 404 };
    return { slab: await loadCopyRow(env, row.id) };
  }
  const rows = await env.DB.prepare(
    "SELECT id, grader FROM slabs WHERE certificate_no = ? AND is_ungraded = 0"
  ).bind(cert).all();
  const list = rows.results || [];
  if (!list.length) return { error: "Nessuna copia digitale con questo certificato", status: 404 };
  if (list.length > 1) {
    return { error: "Più carte hanno questo numero: indica anche il grader (PSA, BGS, CGC…)", status: 400 };
  }
  return { slab: await loadCopyRow(env, list[0].id) };
}

async function countRecentFailures(env, userId) {
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS).toISOString();
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM transfer_attempts WHERE user_id = ? AND success = 0 AND created_at >= ?"
  ).bind(userId, since).first();
  return Number(row && row.n) || 0;
}

async function recordAttempt(env, userId, success) {
  await env.DB.prepare(
    "INSERT INTO transfer_attempts (id, user_id, created_at, success) VALUES (?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), userId, nowIso(), success ? 1 : 0).run();
}

async function openSaleOnSlab(env, slabId) {
  return env.DB.prepare(
    `SELECT id, status FROM sales
     WHERE slab_id = ? AND status IN ('requested','accepted','paid','shipped')
     LIMIT 1`
  ).bind(slabId).first();
}

async function transferDigitalCopy(env, slab, newOwnerId, actorId, audit, reason) {
  if (!hasDigitalCopy(slab)) throw Object.assign(new Error("Questa carta non ha una copia digitale"), { status: 400 });
  if (slab.digital_owner_id === newOwnerId) {
    throw Object.assign(new Error("La copia è già tua"), { status: 400 });
  }
  const openSale = await openSaleOnSlab(env, slab.id);
  if (openSale) {
    throw Object.assign(new Error("C’è una vendita in corso su questa carta. Va chiusa prima del trasferimento."), { status: 409 });
  }
  const rotation = await makeTransferCode();
  const at = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE listings SET status = 'cancelled' WHERE slab_id = ? AND status IN ('active','reserved','paused')"
    ).bind(slab.id),
    env.DB.prepare(
      `UPDATE slabs
       SET digital_owner_id = ?, physical_owner_id = ?, status = 'approved', price_digital_cents = NULL, price_physical_cents = NULL
       WHERE id = ?`
    ).bind(newOwnerId, newOwnerId, slab.id),
    // Rotate in the same batch, after the owner columns so the reveal belongs to the new digital owner.
    ...transferCodeRotateStmts(env, slab.id, rotation),
    // v17: ownership history for the transfer-code path too (whole card: physical + digital).
    env.DB.prepare(
      `INSERT INTO slab_owner_history (id, slab_id, from_user_id, to_user_id, reason, sale_id, created_at, part)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 'fullset')`
    ).bind(crypto.randomUUID(), slab.id, slab.digital_owner_id || null, newOwnerId, "transfer_" + String(reason || "code").slice(0, 20), at)
  ]);
  if (audit) {
    await audit(env, actorId, "digital_copy_transfer", "slab", slab.id, {
      from: slab.digital_owner_id,
      to: newOwnerId,
      reason: reason || "code"
    });
  }
  return rotation.code;
}

function certificateText(copy, code, request, { isNewCode } = {}) {
  const lines = [
    "DreaMint — Certificato della copia digitale",
    "",
    copy.name + " · " + (copy.set_name || "") + " · " + (copy.code_printed || ""),
    "Seriale: " + copy.serial_label,
    "Rarità: " + copy.rarity_label,
    "Grader: " + copy.grader + (copy.grade ? " " + copy.grade : ""),
    "Certificato grader: " + (copy.certificate_no || "—"),
    "Data di assegnazione: " + formatRomeDate(copy.assigned_at),
    "Proprietario: " + copy.owner_name,
    "",
    "Pagina pubblica (3D): " + copy.share_url,
    "Certificato: " + certPageUrl(request, copy.id)
  ];
  if (code) {
    lines.push("");
    lines.push("Codice di trasferimento (segreto, usalo una sola volta):");
    lines.push(code);
    lines.push("");
    lines.push("Se vendi la carta fuori da DreaMint, passa questo certificato e il codice al nuovo proprietario. Una volta usato, il codice scade e ne generiamo uno nuovo.");
  } else if (isNewCode === false) {
    lines.push("");
    lines.push("Il codice di trasferimento è stato inviato alla tua email. Se l’hai perso, genera un nuovo codice dalla tua collezione: il precedente non sarà più valido.");
  }
  return lines.join("\n");
}

function certificateEmailHtml(copy, code, request) {
  const art = copy.art_url || copy.catalog_image || "";
  const qr = "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" + encodeURIComponent(copy.share_url);
  const codeBlock = code
    ? `<div style="margin:24px 0;padding:16px 18px;border:1px dashed #c4a15a;border-radius:12px;background:#fffaf0;text-align:center">
        <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7a5a16;margin-bottom:8px">Codice di trasferimento</div>
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;letter-spacing:.08em;font-weight:700;color:#1a1408">${esc(code)}</div>
        <p style="margin:10px 0 0;font-size:13px;color:#5c5346">Se vendi la carta fuori da DreaMint, passa questo codice insieme al certificato. Si usa una sola volta.</p>
      </div>`
    : "";
  return `<!doctype html><html lang="it"><body style="margin:0;background:#f5f1e8;color:#1a1408;font-family:Georgia,'Times New Roman',serif">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px 40px">
    <p style="margin:0 0 18px;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#8a6a24">DreaMint · Certificato digitale</p>
    <h1 style="font-size:26px;line-height:1.25;margin:0 0 8px">La tua copia digitale è pronta</h1>
    <p style="margin:0 0 20px;color:#5c5346;font-family:system-ui,sans-serif;font-size:15px">Ogni carta gradata verificata riceve una copia unica: seriale e rarità estratti una sola volta. La copia segue la carta.</p>
    ${art ? `<div style="text-align:center;margin:0 0 18px"><img src="${attr(art)}" alt="${attr(copy.name)}" width="240" style="max-width:240px;width:60%;border-radius:10px;border:3px solid #c4a15a"></div>` : ""}
    <table style="width:100%;border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">
      <tr><td style="padding:6px 0;color:#7a7368">Carta</td><td style="padding:6px 0;text-align:right"><strong>${esc(copy.name)}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#7a7368">Set / numero</td><td style="padding:6px 0;text-align:right">${esc(copy.set_name || "")} · ${esc(copy.code_printed || "")}</td></tr>
      <tr><td style="padding:6px 0;color:#7a7368">Seriale</td><td style="padding:6px 0;text-align:right">${esc(copy.serial_label)}</td></tr>
      <tr><td style="padding:6px 0;color:#7a7368">Rarità</td><td style="padding:6px 0;text-align:right">${esc(copy.rarity_label)}</td></tr>
      <tr><td style="padding:6px 0;color:#7a7368">Grader</td><td style="padding:6px 0;text-align:right">${esc(copy.grader)}${copy.grade ? " " + esc(copy.grade) : ""}</td></tr>
      <tr><td style="padding:6px 0;color:#7a7368">N. certificato</td><td style="padding:6px 0;text-align:right">${esc(copy.certificate_no || "—")}</td></tr>
      <tr><td style="padding:6px 0;color:#7a7368">Assegnata il</td><td style="padding:6px 0;text-align:right">${esc(formatRomeDate(copy.assigned_at))}</td></tr>
    </table>
    ${codeBlock}
    <p style="font-family:system-ui,sans-serif;font-size:14px">
      <a href="${attr(certPageUrl(request, copy.id))}" style="color:#7a5a16">Apri il certificato stampabile</a>
      &nbsp;·&nbsp;
      <a href="${attr(copy.share_url)}" style="color:#7a5a16">Pagina pubblica 3D</a>
    </p>
    <img src="${attr(qr)}" width="120" height="120" alt="QR della pagina pubblica" style="margin-top:8px">
    <p style="font-family:system-ui,sans-serif;font-size:12px;color:#7a7368;margin-top:24px">Non è un NFT e non sta su una blockchain. La rarità digitale non ha un valore garantito.</p>
  </div>
  </body></html>`;
}

async function emailCertificate(helpers, env, request, ownerEmail, copy, code) {
  if (!helpers || !helpers.sendNotifyEmail || !ownerEmail) return { skipped: true };
  return helpers.sendNotifyEmail(env, {
    to: ownerEmail,
    subject: "DreaMint: certificato della tua copia digitale — " + copy.name,
    text: certificateText(copy, code, request),
    html: certificateEmailHtml(copy, code, request)
  });
}

async function emailPlain(helpers, env, to, subject, text) {
  if (!helpers || !helpers.sendNotifyEmail || !to) return { skipped: true };
  return helpers.sendNotifyEmail(env, { to, subject, text });
}

export async function issueCertificateForSlab(env, request, slabId, helpers, options) {
  options = options || {};
  const slab = await loadCopyRow(env, slabId);
  if (!hasDigitalCopy(slab)) return { skipped: true, reason: "no_digital_copy" };
  const code = await rotateTransferCode(env, slab.id);
  const copy = presentPublicCopy(slab, request);
  copy.owner_name = slab.digital_owner_name || copy.owner_name;
  const to = options.to || slab.digital_owner_email;
  const mailed = await emailCertificate(helpers, env, request, to, copy, code);
  if (helpers && helpers.audit) {
    await helpers.audit(env, options.actorId || null, "issue_certificate", "slab", slab.id, {
      emailed: !!(mailed && mailed.ok),
      is_test: !!slab.is_test
    });
  }
  return { ok: true, code, copy, mailed };
}

export async function handleCertificateRoutes(request, env, path, url, helpers) {
  const method = request.method.toUpperCase();
  const cors = (helpers && helpers.corsHeaders) || {};
  const J = (data, status) => json(data, status, cors);

  try {
    const copyOne = path.match(/^copies\/([^/]+)$/);
    if (method === "GET" && copyOne) return await publicCopyJson(env, request, copyOne[1], J);

    const stamp = path.match(/^copies\/([^/]+)\/social-stamp$/);
    if (method === "GET" && stamp) return await socialStamp(env, request, stamp[1], J);

    const copyArt = path.match(/^copies\/([^/]+)\/art$/);
    if (method === "GET" && copyArt) return await serveCopyArt(env, request, copyArt[1], J);

    const getCert = path.match(/^cards\/([^/]+)\/certificate$/);
    if (method === "GET" && getCert) return await getCertificate(request, env, getCert[1], url, helpers, J);

    const cardVerif = path.match(/^cards\/([^/]+)\/verification$/);
    if (method === "GET" && cardVerif) return await cardVerification(env, request, cardVerif[1], J);

    const regen = path.match(/^cards\/([^/]+)\/transfer-code$/);
    if (method === "POST" && regen) return await regenerateCode(request, env, regen[1], helpers, J);

    if (method === "POST" && path === "copies/redeem") return await redeemByCode(request, env, helpers, J);

    if (method === "POST" && path === "claims") return await submitClaim(request, env, helpers, J);
    if (method === "GET" && path === "claims") return await myClaims(request, env, helpers, J);

    if (method === "GET" && path === "admin/claims") return await adminListClaims(request, env, helpers, J);
    const admClaim = path.match(/^admin\/claims\/([^/]+)$/);
    if (method === "GET" && admClaim) return await adminClaimDetail(request, env, admClaim[1], helpers, J);
    const admAct = path.match(/^admin\/claims\/([^/]+)\/(approve|reject)$/);
    if (method === "POST" && admAct) {
      return admAct[2] === "approve"
        ? await adminApproveClaim(request, env, admAct[1], helpers, J)
        : await adminRejectClaim(request, env, admAct[1], helpers, J);
    }
    const admPhoto = path.match(/^admin\/claims\/([^/]+)\/photo\/([^/]+)$/);
    if (method === "GET" && admPhoto) return await adminClaimPhoto(request, env, admPhoto[1], admPhoto[2], helpers, J);

    return null;
  } catch (err) {
    const status = err.status || 500;
    return J({ error: err.message || "Errore interno" }, status);
  }
}

// Text the browser prints as a watermark on the «Scarica immagine per i social» canvas (generated
// client-side in js/share.js): current owner + server generation time + live verification link.
async function socialStamp(env, request, id, J) {
  const slab = await loadCopyRow(env, id);
  if (!hasDigitalCopy(slab)) return J({ error: "Copia digitale non trovata" }, 404);
  const copy = presentPublicCopy(slab, request);
  const verify = copy.share_url;
  return new Response(JSON.stringify({
    stamp: {
      owner_label: copy.digital_owner.label,
      digital_owner: copy.digital_owner.label,
      physical_owner: copy.physical_owner.label,
      generated_at: copy.owner_checked_at,
      generated_at_label: copy.owner_checked_label,
      verify_url: verify,
      text: copy.digital_owner.label + " · generata il " + copy.owner_checked_label + " · verifica: " + String(verify).replace(/^https?:\/\//, "")
    }
  }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function publicCopyJson(env, request, id, J) {
  const slab = await loadCopyRow(env, id);
  if (!hasDigitalCopy(slab)) return J({ error: "Copia digitale non trovata" }, 404);
  return J({ copy: presentPublicCopy(slab, request) });
}

// Alias used by card pages: GET /api/cards/:id/verification (same live-owner payload as /api/copies/:id).
async function cardVerification(env, request, id, J) {
  const slab = await loadCopyRow(env, id);
  if (!hasDigitalCopy(slab)) return J({ error: "Copia digitale non trovata" }, 404);
  const copy = presentPublicCopy(slab, request);
  return J({
    copy,
    verification: {
      digital_owner: copy.digital_owner,
      physical_owner: copy.physical_owner,
      full_set: copy.full_set,
      owner_checked_at: copy.owner_checked_at,
      owner_checked_label: copy.owner_checked_label,
      share_url: copy.share_url
    }
  });
}

function parseDataUrl(data) {
  const s = String(data || "");
  const comma = s.indexOf(",");
  if (comma < 0) return null;
  const meta = s.slice(0, comma);
  const b64 = s.slice(comma + 1);
  const mime = (meta.match(/data:([^;]+)/) || [null, "application/octet-stream"])[1];
  let bin;
  try {
    bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch (e) {
    return null;
  }
  return { mime, bin, dataUrl: s };
}

async function serveCopyArt(env, request, id, J) {
  const slab = await loadCopyRow(env, id);
  if (!hasDigitalCopy(slab)) return J({ error: "Copia digitale non trovata" }, 404);

  const headers = {
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=3600"
  };

  if (env.PHOTOS) {
    const w = String((new URL(request.url)).searchParams.get("w") || "");
    const allowedW = ["112", "224", "336", "448", "560", "672"];
    let data = null;
    if (w && allowedW.includes(w)) data = await env.PHOTOS.get("photo:" + id + ":front:w" + w);
    if (!data) data = await env.PHOTOS.get("photo:" + id + ":front");
    const catalogFirst = !!slab.catalog_image;
    if (!catalogFirst && data) {
      const parsed = parseDataUrl(data);
      if (parsed) {
        return safeImageResponse(parsed.bin, headers);
      }
    }
  }

  if (slab.catalog_image) {
    const src = String(slab.catalog_image);
    if (src.startsWith("data:")) {
      const parsed = parseDataUrl(src);
      if (parsed) {
        return safeImageResponse(parsed.bin, headers);
      }
    }
    if (src.startsWith("/") || src.startsWith(CANONICAL_ORIGIN)) {
      // Relative site path: let the caller use it; still try to fetch if absolute.
    }
    try {
      const res = await fetch(src, { redirect: "follow" });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 0 && buf.byteLength <= 8 * 1024 * 1024) {
          if (sniffImageType(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)))) {
            return safeImageResponse(new Uint8Array(buf), headers);
          }
        }
      }
    } catch (e) { /* fall through to seller photo */ }
  }

  if (env.PHOTOS) {
    const data = await env.PHOTOS.get("photo:" + id + ":front");
    const parsed = data && parseDataUrl(data);
    if (parsed) {
      return safeImageResponse(parsed.bin, headers);
    }
  }

  return J({ error: "Immagine non disponibile" }, 404);
}

async function getCertificate(request, env, id, url, helpers, J) {
  const slab = await loadCopyRow(env, id);
  if (!hasDigitalCopy(slab)) return J({ error: "Certificato non disponibile" }, 404);
  const user = helpers.getUser ? await helpers.getUser(request, env) : null;
  const codeParam = String(url.searchParams.get("code") || "").trim();
  const isOwner = user && (user.id === slab.digital_owner_id || (user.role === "admin"));
  let viaCode = false;
  if (!isOwner) {
    if (!codeParam || !slab.transfer_code_hash) return J({ error: "Accedi come proprietario oppure inserisci il codice di trasferimento" }, 401);
    const hash = await sha256Hex(normalizeTransferCode(codeParam));
    if (hash !== slab.transfer_code_hash) return J({ error: "Codice di trasferimento non valido" }, 403);
    viaCode = true;
  }
  const copy = presentPublicCopy(slab, request);
  let issuedCode = null;
  // The plaintext code is shown only to the current digital owner, never to an
  // admin who is not the owner, never via the ?code= preview, never to the seller.
  const isDigitalOwner = !!(user && user.id === slab.digital_owner_id);
  if (isDigitalOwner) {
    const reveal = await env.DB.prepare(
      "SELECT code FROM transfer_code_reveals WHERE slab_id = ? AND user_id = ?"
    ).bind(slab.id, user.id).first();
    if (reveal && reveal.code) issuedCode = reveal.code;
    else if (!slab.transfer_code_hash) {
      const issued = await issueCertificateForSlab(env, request, slab.id, helpers, { actorId: user.id });
      issuedCode = issued && issued.code || null;
    }
  }
  return J({
    certificate: {
      ...copy,
      minted_at: slab.assigned_at,
      minted_at_label: formatRomeDate(slab.assigned_at),
      has_transfer_code: !!(slab.transfer_code_hash || issuedCode),
      transfer_code: issuedCode,
      via_code: viaCode,
      print_url: certPageUrl(request, slab.id)
    }
  });
}

async function regenerateCode(request, env, id, helpers, J) {
  const user = await helpers.requireUser(request, env);
  const slab = await loadCopyRow(env, id);
  if (!hasDigitalCopy(slab)) return J({ error: "Certificato non disponibile" }, 404);
  if (user.id !== slab.digital_owner_id && user.role !== "admin") {
    return J({ error: "Solo il proprietario della copia può generare un nuovo codice" }, 403);
  }
  const code = await rotateTransferCode(env, slab.id);
  const copy = presentPublicCopy(slab, request);
  await emailCertificate(helpers, env, request, slab.digital_owner_email, copy, code);
  if (helpers.audit) await helpers.audit(env, user.id, "regenerate_transfer_code", "slab", slab.id, {});
  return J({ ok: true, transfer_code: code, certificate: copy });
}

async function redeemByCode(request, env, helpers, J) {
  const user = await helpers.requireUser(request, env);
  const failed = await countRecentFailures(env, user.id);
  if (failed >= MAX_FAILED_ATTEMPTS) {
    return J({ error: "Troppi tentativi. Riprova tra 15 minuti." }, 429);
  }
  const body = await helpers.readJson(request);
  const found = await findSlabByCert(env, body.certificate_no, body.grader);
  if (found.error) {
    await recordAttempt(env, user.id, false);
    return J({ error: found.error }, found.status || 400);
  }
  const slab = found.slab;
  if (!hasDigitalCopy(slab) || !slab.transfer_code_hash) {
    await recordAttempt(env, user.id, false);
    return J({ error: "Codice non valido" }, 400);
  }
  const hash = await sha256Hex(normalizeTransferCode(body.transfer_code || body.code || ""));
  if (hash !== slab.transfer_code_hash) {
    await recordAttempt(env, user.id, false);
    return J({ error: "Codice di trasferimento non valido" }, 400);
  }
  let newCode;
  try {
    newCode = await transferDigitalCopy(env, slab, user.id, user.id, helpers.audit, "transfer_code");
  } catch (err) {
    await recordAttempt(env, user.id, false);
    throw err;
  }
  await recordAttempt(env, user.id, true);
  const fresh = await loadCopyRow(env, slab.id);
  const copy = presentPublicCopy(fresh, request);
  await emailCertificate(helpers, env, request, user.email, copy, newCode);
  if (slab.digital_owner_email) {
    await emailPlain(
      helpers,
      env,
      slab.digital_owner_email,
      "DreaMint: la copia digitale è stata trasferita — " + (slab.card_name || "Carta"),
      [
        "La copia digitale di " + (slab.card_name || "una tua carta") + " (" + serialFmt(slab.serial_number, serialTotalFor(slab)) + ") è stata riscattata da " + (user.display_name || "un collezionista") + " con il codice di trasferimento.",
        "",
        "Seriale e rarità restano gli stessi. Il vecchio codice non è più valido.",
        "",
        "Se non hai passato tu il certificato, scrivi a info@dreamint.it."
      ].join("\n")
    );
  }
  return J({ ok: true, copy, transfer_code: newCode });
}

function parseClaimPhotos(body) {
  const raw = body.photos || body.images || [];
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_CLAIM_PHOTOS);
}

async function submitClaim(request, env, helpers, J) {
  const user = await helpers.requireUser(request, env);
  const body = await helpers.readJson(request);
  const found = await findSlabByCert(env, body.certificate_no, body.grader);
  if (found.error) return J({ error: found.error }, found.status || 400);
  const slab = found.slab;
  if (!hasDigitalCopy(slab)) return J({ error: "Questa carta non ha una copia digitale" }, 400);
  if (slab.digital_owner_id === user.id) return J({ error: "La copia è già tua" }, 400);

  const pending = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM digital_claims WHERE claimant_id = ? AND status = 'pending'"
  ).bind(user.id).first();
  if (Number(pending && pending.n) >= 5) {
    return J({ error: "Hai già troppe richieste in attesa" }, 429);
  }
  const existing = await env.DB.prepare(
    "SELECT id FROM digital_claims WHERE slab_id = ? AND claimant_id = ? AND status IN ('pending','approved')"
  ).bind(slab.id, user.id).first();
  if (existing) return J({ error: "Hai già una richiesta aperta per questa carta" }, 409);

  const photos = parseClaimPhotos(body);
  if (photos.length < 1) {
    return J({ error: "Carica almeno una foto della carta insieme a un foglietto con il tuo nome utente" }, 400);
  }
  for (let i = 0; i < photos.length; i++) {
    const raw = photos[i] && (photos[i].data || photos[i].data_url || photos[i]);
    const parsed = sanitizeImageDataUrl(raw) ? parseImageDataUrl(raw) : null;
    if (!parsed || !parsed.mime) return J({ error: "Una delle foto non è valida (solo JPEG, PNG o WebP)" }, 400);
    if (parsed.bin.byteLength > MAX_PHOTO_BYTES) {
      return J({ error: "Ogni foto deve pesare meno di 1,5 MB" }, 400);
    }
  }

  const id = crypto.randomUUID();
  const created = nowIso();
  const disputeUntil = addDaysIso(created, DISPUTE_DAYS);
  await env.DB.prepare(
    `INSERT INTO digital_claims (
      id, slab_id, claimant_id, grader, certificate_no, message, status, admin_note,
      photo_count, created_at, reviewed_at, reviewed_by, dispute_until
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, NULL, NULL, ?)`
  ).bind(
    id,
    slab.id,
    user.id,
    slab.grader,
    slab.certificate_no,
    String(body.message || "").slice(0, 1000),
    photos.length,
    created,
    disputeUntil
  ).run();

  if (env.PHOTOS) {
    for (let i = 0; i < photos.length; i++) {
      const raw = photos[i] && (photos[i].data || photos[i].data_url || photos[i]);
      await env.PHOTOS.put("claim:" + id + ":photo:" + i, sanitizeImageDataUrl(raw));
    }
  }

  if (helpers.notifyAdminSafe) {
    try {
      await helpers.notifyAdminSafe(env, request, {
        subject: "DreaMint: richiesta riscatto copia digitale — " + (slab.card_name || "Carta"),
        title: "Nuova richiesta di riscatto (vendita fuori da DreaMint).",
        cardName: slab.card_name,
        setName: slab.set_name,
        code: slab.code_printed,
        typeLabel: slab.grader + " " + (slab.certificate_no || ""),
        buyerName: user.display_name,
        link: siteOrigin(request) + "/#/admin/riscatti/" + id
      });
    } catch (e) { /* ignore */ }
  }
  if (helpers.audit) await helpers.audit(env, user.id, "submit_digital_claim", "claim", id, { slab_id: slab.id });

  return J({
    ok: true,
    claim: {
      id,
      status: "pending",
      dispute_until: disputeUntil,
      dispute_until_label: formatRomeDate(disputeUntil),
      message: "La richiesta è in verifica. Un operatore la controllerà; di solito il trasferimento avviene dopo 7 giorni (finestra di contestazione per il proprietario attuale)."
    }
  }, 201);
}

function presentClaim(row, extra) {
  return Object.assign({
    id: row.id,
    slab_id: row.slab_id,
    status: row.status,
    grader: row.grader,
    certificate_no: row.certificate_no,
    message: row.message,
    admin_note: row.admin_note,
    photo_count: row.photo_count,
    created_at: row.created_at,
    created_at_label: formatRomeDate(row.created_at),
    reviewed_at: row.reviewed_at,
    dispute_until: row.dispute_until,
    dispute_until_label: formatRomeDate(row.dispute_until),
    window_open: !!(row.dispute_until && new Date(row.dispute_until).getTime() > Date.now()),
    card_name: row.card_name,
    set_name: row.set_name,
    code_printed: row.code_printed,
    rarity_tier: row.rarity_tier,
    serial_number: row.serial_number,
    claimant_name: row.claimant_name,
    claimant_email: row.claimant_email,
    owner_name: row.owner_name,
    owner_email: row.owner_email
  }, extra || {});
}

async function myClaims(request, env, helpers, J) {
  const user = await helpers.requireUser(request, env);
  const rows = await env.DB.prepare(
    `SELECT cl.*, m.name AS card_name, m.set_name, m.code_printed, s.rarity_tier, s.serial_number
     FROM digital_claims cl
     JOIN slabs s ON s.id = cl.slab_id
     JOIN card_models m ON m.id = s.card_model_id
     WHERE cl.claimant_id = ?
     ORDER BY cl.created_at DESC`
  ).bind(user.id).all();
  return J({ claims: (rows.results || []).map((r) => presentClaim(r)) });
}

async function adminListClaims(request, env, helpers, J) {
  await helpers.requireAdmin(request, env);
  const rows = await env.DB.prepare(
    `SELECT cl.*, m.name AS card_name, m.set_name, m.code_printed,
            s.rarity_tier, s.serial_number, s.grader AS slab_grader,
            u.display_name AS claimant_name, u.email AS claimant_email,
            o.display_name AS owner_name, o.email AS owner_email
     FROM digital_claims cl
     JOIN slabs s ON s.id = cl.slab_id
     JOIN card_models m ON m.id = s.card_model_id
     JOIN users u ON u.id = cl.claimant_id
     LEFT JOIN users o ON o.id = s.digital_owner_id
     ORDER BY CASE cl.status WHEN 'pending' THEN 0 ELSE 1 END, cl.created_at DESC`
  ).all();
  return J({ claims: (rows.results || []).map((r) => presentClaim(r)) });
}

async function loadClaim(env, id) {
  return env.DB.prepare(
    `SELECT cl.*, m.name AS card_name, m.set_name, m.code_printed, m.catalog_image,
            s.rarity_tier, s.serial_number, s.digital_owner_id, s.physical_owner_id,
            s.status AS slab_status, s.is_ungraded, s.grade, s.is_test,
            u.display_name AS claimant_name, u.email AS claimant_email,
            o.display_name AS owner_name, o.email AS owner_email
     FROM digital_claims cl
     JOIN slabs s ON s.id = cl.slab_id
     JOIN card_models m ON m.id = s.card_model_id
     JOIN users u ON u.id = cl.claimant_id
     LEFT JOIN users o ON o.id = s.digital_owner_id
     WHERE cl.id = ?`
  ).bind(id).first();
}

async function adminClaimDetail(request, env, id, helpers, J) {
  await helpers.requireAdmin(request, env);
  const row = await loadClaim(env, id);
  if (!row) return J({ error: "Richiesta non trovata" }, 404);
  const photos = [];
  for (let i = 0; i < (row.photo_count || 0); i++) {
    photos.push("/api/admin/claims/" + encodeURIComponent(id) + "/photo/" + i);
  }
  return J({ claim: presentClaim(row, { photos, can_approve: row.status === "pending" }) });
}

async function adminClaimPhoto(request, env, id, idx, helpers, J) {
  await helpers.requireAdmin(request, env);
  const n = Number(idx);
  if (!Number.isInteger(n) || n < 0 || n > 10) return J({ error: "Foto sconosciuta" }, 404);
  const data = env.PHOTOS ? await env.PHOTOS.get("claim:" + id + ":photo:" + n) : null;
  const parsed = data && parseImageDataUrl(data);
  if (!parsed) return J({ error: "Foto non presente" }, 404);
  return safeImageResponse(parsed.bin, { "cache-control": "private, max-age=300" });
}

async function adminApproveClaim(request, env, id, helpers, J) {
  const admin = await helpers.requireAdmin(request, env);
  const body = await helpers.readJson(request).catch(() => ({}));
  const row = await loadClaim(env, id);
  if (!row) return J({ error: "Richiesta non trovata" }, 404);
  if (row.status !== "pending") return J({ error: "Questa richiesta è già stata chiusa" }, 400);

  const windowOpen = row.dispute_until && new Date(row.dispute_until).getTime() > Date.now();
  if (windowOpen && !body.force) {
    return J({
      error: "La finestra di contestazione è aperta fino al " + formatRomeDate(row.dispute_until) + ". Riprova dopo quella data, oppure conferma l’approvazione anticipata.",
      dispute_until: row.dispute_until,
      needs_force: true
    }, 409);
  }

  const slab = await loadCopyRow(env, row.slab_id);
  const newCode = await transferDigitalCopy(env, slab, row.claimant_id, admin.id, helpers.audit, "claim_approved");
  await env.DB.prepare(
    "UPDATE digital_claims SET status = 'approved', reviewed_at = ?, reviewed_by = ?, admin_note = ? WHERE id = ?"
  ).bind(nowIso(), admin.id, String(body.note || "").slice(0, 500), id).run();

  const fresh = await loadCopyRow(env, row.slab_id);
  const copy = presentPublicCopy(fresh, request);
  await emailCertificate(helpers, env, request, row.claimant_email, copy, newCode);
  if (row.owner_email) {
    await emailPlain(
      helpers,
      env,
      row.owner_email,
      "DreaMint: la copia digitale è stata trasferita — " + (row.card_name || "Carta"),
      [
        "Abbiamo approvato una richiesta di riscatto sulla copia digitale di " + (row.card_name || "una tua carta") + ".",
        "Il nuovo proprietario ha inviato le foto della carta e un foglietto con il proprio nome utente.",
        "",
        "Seriale e rarità restano gli stessi. Se vuoi contestare, scrivi a info@dreamint.it."
      ].join("\n")
    );
  }
  return J({ ok: true, claim_id: id, copy });
}

async function adminRejectClaim(request, env, id, helpers, J) {
  const admin = await helpers.requireAdmin(request, env);
  const body = await helpers.readJson(request);
  const reason = String(body.reason || body.note || "").trim();
  if (reason.length < 3) return J({ error: "Indica il motivo del rifiuto" }, 400);
  const row = await loadClaim(env, id);
  if (!row) return J({ error: "Richiesta non trovata" }, 404);
  if (row.status !== "pending") return J({ error: "Questa richiesta è già stata chiusa" }, 400);
  await env.DB.prepare(
    "UPDATE digital_claims SET status = 'rejected', reviewed_at = ?, reviewed_by = ?, admin_note = ? WHERE id = ?"
  ).bind(nowIso(), admin.id, reason.slice(0, 500), id).run();
  if (helpers.audit) await helpers.audit(env, admin.id, "reject_digital_claim", "claim", id, { reason });
  if (row.claimant_email) {
    await emailPlain(
      helpers,
      env,
      row.claimant_email,
      "DreaMint: richiesta di riscatto non approvata — " + (row.card_name || "Carta"),
      "La tua richiesta di riscatto per " + (row.card_name || "la carta") + " non è stata approvata.\n\nMotivo: " + reason + "\n\nSe hai domande: info@dreamint.it"
    );
  }
  return J({ ok: true });
}

export function renderSharePageHtml(copy, request) {
  const title = (copy.name || "Copia digitale") + " · " + (copy.rarity_label || "") + " " + (copy.serial_label || "") + " — DreaMint";
  const desc = (copy.name || "Carta") + " è " + (copy.rarity_label || "unica") + " su DreaMint, seriale " + (copy.serial_label || "") + ". Copia digitale unica, con cornice di rarità.";
  const ogImage = copy.art_url;
  const noindex = copy.is_test ? '<meta name="robots" content="noindex,nofollow" />\n' : "";
  const tier = copy.rarity_tier || "";
  const art = copy.art_url || copy.catalog_image || "";
  const back = "/img/dreamint-icon.webp?v=20261110e";
  const cert = (copy.grader || "") + (copy.certificate_no ? " " + copy.certificate_no : "");
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${esc(title)}</title>
  <meta name="description" content="${attr(desc)}" />
  ${noindex}<link rel="canonical" href="${attr(copy.share_url)}" />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="it_IT" />
  <meta property="og:site_name" content="DreaMint" />
  <meta property="og:url" content="${attr(copy.share_url)}" />
  <meta property="og:title" content="${attr(title)}" />
  <meta property="og:description" content="${attr(desc)}" />
  <meta property="og:image" content="${attr(ogImage)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${attr(title)}" />
  <meta name="twitter:description" content="${attr(desc)}" />
  <meta name="twitter:image" content="${attr(ogImage)}" />
  <link rel="icon" href="/favicon.ico?v=20261112v3" sizes="any" />
  <link rel="icon" href="/favicon-32.png?v=20261112v3" type="image/png" sizes="32x32" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=20261112v3" />
  <link rel="stylesheet" href="/fonts.css?v=20261110e" />
  <link rel="stylesheet" href="/styles.css?v=20261110e" />
  <link rel="stylesheet" href="/certificate.css?v=20261110e" />
  <script>
    (function () {
      try {
        var saved = localStorage.getItem("gemint-theme");
        var theme = saved || ((window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light");
        document.documentElement.setAttribute("data-theme", theme);
      } catch (e) { document.documentElement.setAttribute("data-theme", "light"); }
    })();
  </script>
</head>
<body class="share-body">
  <header class="share-top">
    <a class="brand" href="https://dreamint.it/" aria-label="DreaMint">
      <img class="brand-logo brand-logo-light" src="/img/dreamint-logo-full.webp?v=20261110e" width="645" height="200" alt="DreaMint" />
      <img class="brand-logo brand-logo-dark" src="/img/dreamint-logo-full-dark.webp?v=20261110e" width="645" height="200" alt="DreaMint" />
    </a>
  </header>
  <main class="share-main">
    <p class="kicker">Copia digitale unica</p>
    <h1>${esc(copy.name || "Carta")}</h1>
    <p class="share-sub">${esc(copy.set_name || "")} · ${esc(copy.code_printed || "")}</p>
    <div class="share-stage">
      <button type="button" class="hero-card is-front" data-hero-card data-pos="0" aria-label="${attr(copy.name || "Carta")}, trascina per ruotare, tocca per girare">
        <div class="hero-card-spin" data-spin>
          <div class="hero-card-face is-front">
            <div class="slab-3d${tier === "mitica" || tier === "leggendaria" ? " slab-hype" : ""} share-slab" data-tilt data-tier="${attr(tier)}">
              <div class="slab-aura" aria-hidden="true"></div>
              <div class="slab-acrylic"><div class="slab-window">
                <div class="slab-art has-real-photo"><img class="slab-photo" src="${attr(art)}" alt=""></div>
                <div class="slab-holo"></div><div class="slab-shine"></div><div class="slab-foil"></div>
                <div class="slab-glare"></div><div class="slab-noise"></div>
                <div class="slab-glass"></div>
                ${tier === "mitica" || tier === "leggendaria" ? '<div class="slab-sparkles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>' : ""}
                ${copy.rarity_label ? '<span class="slab-tier-chip">' + esc(copy.rarity_label) + "</span>" : ""}
              </div>
              <div class="slab-label"><div class="lab-left"><span class="lab-grader">${esc(copy.grader || "DreaMint")}</span>
              <span class="lab-serial">${esc(copy.serial_label || "")}</span>
              ${cert ? '<span class="lab-serial">' + esc(cert) + "</span>" : ""}
              </div><span class="lab-grade">${esc(copy.grade || "—")}</span></div></div></div>
          </div>
          <div class="hero-card-face is-back">
            <div class="hero-card-back" aria-hidden="true"><div class="dreamint-card-back">
              <img src="${attr(back)}" width="512" height="512" alt="">
            </div></div>
          </div>
        </div>
      </button>
      <p class="hero-fan-hint">Trascina per girare · tocca per capovolgere</p>
    </div>
    <ul class="share-facts">
      <li><span>Proprietario copia digitale</span><strong>${esc(copy.digital_owner ? copy.digital_owner.label : "Collezionista privato")}</strong></li>
      <li><span>Proprietario carta fisica</span><strong>${esc(copy.physical_owner ? copy.physical_owner.label : "Collezionista privato")}</strong></li>
      <li><span>Rarità</span><strong>${esc(copy.rarity_label || "—")}</strong></li>
      <li><span>Seriale</span><strong>${esc(copy.serial_label || "—")}</strong></li>
      <li><span>Grader</span><strong>${esc(copy.grader || "—")}${copy.grade ? " " + esc(copy.grade) : ""}</strong></li>
    </ul>
    <div class="share-cta">
      <button type="button" class="btn primary" id="share-copy-btn">Condividi</button>
      <a class="btn ghost" href="https://dreamint.it/#/gradate">Scopri DreaMint</a>
    </div>
    <p class="share-live-check">Proprietari verificati in tempo reale il ${esc(copy.owner_checked_label || "")}. Uno screenshot non prova la proprietà: controlla sempre questa pagina.</p>
    ${copy.is_test ? '<p class="pill pill-test">Carta TEST — non è una copia reale</p>' : ""}
  </main>
  <script src="/js/share.js?v=20261110e"></script>
  <script>
    window.__DREAMINT_SHARE__ = ${JSON.stringify({
      id: copy.id,
      name: copy.name,
      set_name: copy.set_name,
      code_printed: copy.code_printed,
      rarity_tier: copy.rarity_tier,
      rarity_label: copy.rarity_label,
      serial_number: copy.serial_number,
      serial_total: copy.serial_total,
      serial_label: copy.serial_label,
      grader: copy.grader,
      grade: copy.grade,
      owner_name: copy.owner_name,
      digital_owner: copy.digital_owner && copy.digital_owner.label,
      physical_owner: copy.physical_owner && copy.physical_owner.label,
      owner_checked_at: copy.owner_checked_at,
      share_url: copy.share_url,
      art_url: copy.art_url,
      photoUrl: copy.art_url
    })};
    if (window.DreaMintShare && window.DreaMintShare.bootSharePage) window.DreaMintShare.bootSharePage();
  </script>
</body>
</html>`;
}

export async function renderPublicSharePage(request, env, id) {
  const slab = await loadCopyRow(env, id);
  if (!hasDigitalCopy(slab)) {
    return new Response(
      `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>Copia non trovata — DreaMint</title>
       <link rel="stylesheet" href="/styles.css?v=20261110e"></head>
       <body style="padding:48px 20px"><main class="panel" style="max-width:480px;margin:0 auto">
       <h1>Copia digitale non trovata</h1>
       <p>Questo link non corrisponde a una copia pubblica.</p>
       <p><a href="https://dreamint.it/">Torna a DreaMint</a></p></main></body></html>`,
      { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }
  const copy = presentPublicCopy(slab, request);
  return new Response(renderSharePageHtml(copy, request), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Live owner check: never served from a cache.
      "cache-control": "no-store",
      "x-robots-tag": copy.is_test ? "noindex, nofollow" : "index, follow"
    }
  });
}

export { TIER_LABELS, serialFmt, generateTransferCode, normalizeTransferCode, hasDigitalCopy, presentPublicCopy };
