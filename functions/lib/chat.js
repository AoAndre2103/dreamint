// Buyer ↔ seller chat tied to a listing (migrate-v18.sql). Plain text only (stored raw, the frontend
// renders it as text). Participants see only usernames; e-mails and phone numbers are MASKED in what
// participants receive (stored raw for moderation: admins see body_raw). Messages that look like an
// attempt to move the deal off PayPal / off the site are saved with warning=1 + codes (warn, never block).
import { enforceIdentRule } from "./rate-limit.js";
import { isEmailVerified } from "./email-verify.js";
import { canSeeTest, isHiddenTest, testVisibleSql } from "./visibility.js";

export const MESSAGE_MAX = 1000;
export const REPORT_REASONS = ["spam", "off_platform_payment", "scam", "abuse", "other"];
const MIN = 60, HOUR = 3600;
export const CHAT_RULES = {
  start: { name: "chat-start", limit: 30, windowSec: HOUR },
  userMin: { name: "chat-user-min", limit: 15, windowSec: MIN },
  userHour: { name: "chat-user-hour", limit: 200, windowSec: HOUR },
  convMin: { name: "chat-conv-min", limit: 8, windowSec: MIN },
  report: { name: "chat-report", limit: 10, windowSec: HOUR },
  block: { name: "chat-block", limit: 30, windowSec: HOUR }
};

const RE_PAY = /(bonifico|\biban\b|ricarica|postepay|satispay|revolut|contanti|\bcash\b|western\s*union|moneygram|amici\s*e\s*parenti|friends\s*(and|&)\s*family|fuori\s*(dal|dal\s+)?\s*sito|fuori\s+(da\s+)?dreamint|bitcoin|\bcrypto\b|paypal\s*amici)/i;
const RE_EMAIL = /[A-Z0-9._%+-]+\s*(@|\(at\)|\[at\])\s*[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const RE_PHONE = /(\+|00)?\d[\d\s.\-()]{7,}\d/g;
const RE_LINK = /\b((https?:\/\/|www\.)[^\s<>"]+|[a-z0-9-]{2,}\.(com|it|net|org|eu|io|me|ly|app|link|shop|store|info|biz)(\/[^\s<>"]*)?)\b/gi;
// Italian mobile (3xx…) or landline (0…), optional +39 / 0039 prefix: dates and prices are not phones.
const isPhone = (m) => /^(39|0039)?(3\d{8,9}|0\d{6,10})$/.test(m.replace(/\D/g, ""));
const isOwnSite = (m) => /(^|\.|\/\/)dreamint\.it(\/|$)/i.test(m);

// Plain text: CRLF -> LF, control characters removed (newline / tab kept), trimmed.
export function cleanMessage(raw) {
  return String(raw == null ? "" : raw).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u2028-\u202E\u2066-\u2069]/g, "").trim();
}

export function detectWarnings(text) {
  const codes = [];
  if (RE_PAY.test(text)) codes.push("off_platform_payment");
  if ((text.match(RE_EMAIL) || []).length) codes.push("email");
  if ((text.match(RE_PHONE) || []).some(isPhone)) codes.push("phone");
  if ((text.match(RE_LINK) || []).some((m) => !isOwnSite(m) && !/@/.test(m))) codes.push("external_link");
  return codes;
}

export function maskContacts(text) {
  return text
    .replace(RE_EMAIL, "[email nascosta]")
    .replace(RE_PHONE, (m) => (isPhone(m) ? "[telefono nascosto]" : m));
}

function J(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}
const err = (status, code, error) => J({ error, code }, status);

async function blockedBetween(env, a, b) {
  const r = await env.DB.prepare(
    "SELECT blocker_id FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1"
  ).bind(a, b, b, a).first();
  return r ? r.blocker_id : null;
}

async function loadConversation(env, id) {
  return env.DB.prepare(
    `SELECT c.*, b.username AS buyer_username, s.username AS seller_username,
            l.status AS listing_status, l.kind AS listing_kind, l.price_cents AS listing_price_cents,
            m.name AS card_name, sl.is_test AS is_test
     FROM conversations c
     JOIN users b ON b.id = c.buyer_id
     JOIN users s ON s.id = c.seller_id
     LEFT JOIN listings l ON l.id = c.listing_id
     LEFT JOIN slabs sl ON sl.id = c.slab_id
     LEFT JOIN card_models m ON m.id = sl.card_model_id
     WHERE c.id = ?`
  ).bind(id).first();
}

function presentConversation(c, user, extra) {
  const admin = user.role === "admin";
  const role = user.id === c.buyer_id ? "buyer" : user.id === c.seller_id ? "seller" : "admin";
  const other = role === "buyer" ? c.seller_username : c.buyer_username;
  const out = {
    id: c.id,
    listing_id: c.listing_id,
    slab_id: c.slab_id,
    card_name: c.card_name || null,
    listing_status: c.listing_status || null,
    listing_kind: c.listing_kind === "digital" || c.listing_kind === "physical" ? c.listing_kind : "fullset",
    listing_price_cents: c.listing_price_cents || null,
    role,
    other_username: role === "admin" ? null : (other || null),
    other_label: role === "admin" ? null : (other ? "@" + other : "Collezionista"),
    created_at: c.created_at,
    last_message_at: c.last_message_at || null,
    ...(extra || {})
  };
  if (admin && role === "admin") {
    out.buyer_username = c.buyer_username || null;
    out.seller_username = c.seller_username || null;
  }
  return out;
}

function presentMessage(m, user, admin) {
  return {
    id: m.id,
    mine: m.sender_id === user.id,
    sender_username: m.sender_username || null,
    body: maskContacts(m.body),
    ...(admin ? { body_raw: m.body } : {}),
    created_at: m.created_at,
    warning: !!m.warning,
    warning_codes: m.warning_codes ? m.warning_codes.split(",") : []
  };
}

function canAccess(c, user) {
  return !!(c && user && (user.id === c.buyer_id || user.id === c.seller_id || user.role === "admin"));
}

// Returns a Response for chat routes, or null when the path is not a chat route.
export async function handleChatRoutes(request, env, method, path, url, h) {
  const startM = path.match(/^listings\/([^/]+)\/conversation$/);
  const convM = path.match(/^conversations\/([^/]+)(?:\/(messages|read|report|block))?$/);
  const adminList = path === "admin/chat-reports";
  const adminOne = path.match(/^admin\/chat-reports\/([^/]+)$/);
  if (!startM && !convM && path !== "conversations" && !adminList && !adminOne) return null;
  const user = await h.requireUser(request, env);
  if (adminList || adminOne) {
    if (user.role !== "admin") return err(403, "forbidden", "Solo admin");
    if (adminList && method === "GET") return adminReports(env, url);
    if (adminOne && method === "POST") return adminResolveReport(env, request, user, adminOne[1], h);
    return err(405, "method_not_allowed", "Metodo non consentito");
  }
  if (!isEmailVerified(user)) return err(403, "email_not_verified", "Conferma la tua email per usare la chat");

  if (startM && method === "POST") {
    const listing = await env.DB.prepare("SELECT id, slab_id, seller_id, status FROM listings WHERE id = ?").bind(startM[1]).first();
    if (!listing || !["active", "reserved", "paused"].includes(listing.status)) return err(404, "not_found", "Annuncio non disponibile");
    const listedSlab = await env.DB.prepare("SELECT is_test FROM slabs WHERE id = ?").bind(listing.slab_id).first();
    if (isHiddenTest(listedSlab, user)) return err(404, "not_found", "Annuncio non disponibile");
    if (listing.seller_id === user.id) return err(400, "own_listing", "È un tuo annuncio");
    if (await blockedBetween(env, user.id, listing.seller_id)) return err(403, "blocked", "Non puoi scrivere a questo utente");
    let c = await env.DB.prepare("SELECT id FROM conversations WHERE listing_id = ? AND buyer_id = ?").bind(listing.id, user.id).first();
    let created = false;
    if (!c) {
      await enforceIdentRule(env, CHAT_RULES.start, user.id);
      const id = crypto.randomUUID();
      const r = await env.DB.prepare(
        `INSERT OR IGNORE INTO conversations (id, listing_id, slab_id, buyer_id, seller_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(id, listing.id, listing.slab_id, user.id, listing.seller_id, h.nowIso()).run();
      created = !!(r.meta && r.meta.changes);
      c = await env.DB.prepare("SELECT id FROM conversations WHERE listing_id = ? AND buyer_id = ?").bind(listing.id, user.id).first();
    }
    const full = await loadConversation(env, c.id);
    return J({ conversation: presentConversation(full, user, { unread: 0 }) }, created ? 201 : 200);
  }

  if (path === "conversations" && method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT c.*, b.username AS buyer_username, s.username AS seller_username,
              l.status AS listing_status, l.kind AS listing_kind, l.price_cents AS listing_price_cents, m.name AS card_name,
              (SELECT COUNT(*) FROM messages mm WHERE mm.conversation_id = c.id AND mm.sender_id <> ?
                 AND mm.created_at > COALESCE(CASE WHEN c.buyer_id = ? THEN c.buyer_last_read_at ELSE c.seller_last_read_at END, '')) AS unread,
              (SELECT mm.body FROM messages mm WHERE mm.conversation_id = c.id ORDER BY mm.rowid DESC LIMIT 1) AS last_body,
              (SELECT mm.warning FROM messages mm WHERE mm.conversation_id = c.id ORDER BY mm.rowid DESC LIMIT 1) AS last_warning,
              EXISTS (SELECT 1 FROM user_blocks ub WHERE ub.blocker_id = ? AND ub.blocked_id = CASE WHEN c.buyer_id = ? THEN c.seller_id ELSE c.buyer_id END) AS blocked_by_me
       FROM conversations c
       JOIN users b ON b.id = c.buyer_id
       JOIN users s ON s.id = c.seller_id
       LEFT JOIN listings l ON l.id = c.listing_id
       LEFT JOIN slabs sl ON sl.id = c.slab_id
       LEFT JOIN card_models m ON m.id = sl.card_model_id
       WHERE (c.buyer_id = ? OR c.seller_id = ?) AND ${testVisibleSql(user, "sl")}
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
       LIMIT 100`
    ).bind(user.id, user.id, user.id, user.id, user.id, user.id).all();
    const list = (rows.results || []).map((c) => presentConversation(c, user, {
      unread: Number(c.unread) || 0,
      last_message_preview: c.last_body ? maskContacts(c.last_body).slice(0, 120) : null,
      last_message_warning: !!c.last_warning,
      blocked_by_me: !!c.blocked_by_me
    }));
    return J({ conversations: list, unread_total: list.reduce((n, c) => n + c.unread, 0) });
  }

  if (!convM) return err(404, "not_found", "Non trovato");
  const c = await loadConversation(env, convM[1]);
  // IDOR: a conversation of other people is indistinguishable from a missing one.
  if (!canAccess(c, user) || isHiddenTest(c, user)) return err(404, "not_found", "Conversazione non trovata");
  const action = convM[2] || "";
  const participant = user.id === c.buyer_id || user.id === c.seller_id;
  const otherId = user.id === c.buyer_id ? c.seller_id : c.buyer_id;
  const admin = user.role === "admin";

  if (action === "messages" && method === "GET") {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const before = url.searchParams.get("before");
    let rows;
    const base = `SELECT mm.rowid AS seq, mm.*, u.username AS sender_username FROM messages mm JOIN users u ON u.id = mm.sender_id WHERE mm.conversation_id = ?`;
    if (before) {
      rows = await env.DB.prepare(base + ` AND mm.rowid < (SELECT rowid FROM messages WHERE id = ? AND conversation_id = ?) ORDER BY mm.rowid DESC LIMIT ?`)
        .bind(c.id, before, c.id, limit + 1).all();
    } else {
      rows = await env.DB.prepare(base + " ORDER BY mm.rowid DESC LIMIT ?").bind(c.id, limit + 1).all();
    }
    const list = rows.results || [];
    const more = list.length > limit;
    const page = list.slice(0, limit).reverse();
    const blocker = participant ? await blockedBetween(env, user.id, otherId) : null;
    return J({
      conversation: presentConversation(c, user, { blocked_by_me: blocker === user.id, blocked_by_other: !!blocker && blocker !== user.id }),
      messages: page.map((m) => presentMessage(m, user, admin)),
      next_before: more && page.length ? page[0].id : null
    });
  }

  if (action === "messages" && method === "POST") {
    if (!participant) return err(403, "forbidden", "Solo i partecipanti possono scrivere");
    const body = await h.readJson(request) || {};
    const text = cleanMessage(body.body != null ? body.body : body.text);
    if (!text) return err(400, "message_empty", "Scrivi un messaggio");
    if (text.length > MESSAGE_MAX) return err(400, "message_too_long", `Massimo ${MESSAGE_MAX} caratteri`);
    if (await blockedBetween(env, user.id, otherId)) return err(403, "blocked", "Non puoi scrivere a questo utente");
    await enforceIdentRule(env, CHAT_RULES.userMin, user.id);
    await enforceIdentRule(env, CHAT_RULES.userHour, user.id);
    await enforceIdentRule(env, CHAT_RULES.convMin, user.id + ":" + c.id);
    const codes = detectWarnings(text);
    const id = crypto.randomUUID(), at = h.nowIso();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO messages (id, conversation_id, sender_id, body, created_at, warning, warning_codes) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, c.id, user.id, text, at, codes.length ? 1 : 0, codes.length ? codes.join(",") : null),
      env.DB.prepare(`UPDATE conversations SET last_message_at = ?, ${user.id === c.buyer_id ? "buyer_last_read_at" : "seller_last_read_at"} = ? WHERE id = ?`)
        .bind(at, at, c.id)
    ]);
    const me = await env.DB.prepare("SELECT username FROM users WHERE id = ?").bind(user.id).first();
    return J({ message: presentMessage({ id, sender_id: user.id, sender_username: me && me.username, body: text, created_at: at, warning: codes.length ? 1 : 0, warning_codes: codes.join(",") }, user, false) }, 201);
  }

  if (action === "read" && method === "POST") {
    if (!participant) return err(403, "forbidden", "Solo i partecipanti");
    await env.DB.prepare(`UPDATE conversations SET ${user.id === c.buyer_id ? "buyer_last_read_at" : "seller_last_read_at"} = ? WHERE id = ?`)
      .bind(h.nowIso(), c.id).run();
    return J({ ok: true, unread: 0 });
  }

  if (action === "report" && method === "POST") {
    if (!participant) return err(403, "forbidden", "Solo i partecipanti");
    const body = await h.readJson(request) || {};
    const reason = String(body.reason || "");
    if (!REPORT_REASONS.includes(reason)) return err(400, "reason_invalid", "Motivo non valido");
    let messageId = null;
    if (body.message_id) {
      const m = await env.DB.prepare("SELECT id FROM messages WHERE id = ? AND conversation_id = ?").bind(String(body.message_id), c.id).first();
      if (!m) return err(404, "message_not_found", "Messaggio non trovato");
      messageId = m.id;
    }
    await enforceIdentRule(env, CHAT_RULES.report, user.id);
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO chat_reports (id, conversation_id, message_id, reporter_id, reason, note, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')")
      .bind(id, c.id, messageId, user.id, reason, cleanMessage(body.note).slice(0, 500) || null, h.nowIso()).run();
    await h.audit(env, user.id, "chat_report", "conversation", c.id, { report_id: id, reason, message_id: messageId });
    return J({ report: { id, status: "open" } }, 201);
  }

  if (action === "block" && (method === "POST" || method === "DELETE")) {
    if (!participant) return err(403, "forbidden", "Solo i partecipanti");
    await enforceIdentRule(env, CHAT_RULES.block, user.id);
    if (method === "POST") {
      await env.DB.prepare("INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").bind(user.id, otherId, h.nowIso()).run();
    } else {
      await env.DB.prepare("DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?").bind(user.id, otherId).run();
    }
    await h.audit(env, user.id, method === "POST" ? "chat_block" : "chat_unblock", "conversation", c.id, {});
    return J({ ok: true, blocked: method === "POST" });
  }

  return err(405, "method_not_allowed", "Metodo non consentito");
}

async function adminReports(env, url) {
  const status = url.searchParams.get("status") === "closed" ? "closed" : "open";
  const rows = await env.DB.prepare(
    `SELECT r.*, ru.username AS reporter_username, c.listing_id, c.slab_id, c.buyer_id, c.seller_id,
            b.username AS buyer_username, s.username AS seller_username, m.name AS card_name,
            msg.body AS message_body, msg.created_at AS message_created_at, mu.username AS message_sender_username
     FROM chat_reports r
     JOIN conversations c ON c.id = r.conversation_id
     JOIN users ru ON ru.id = r.reporter_id
     JOIN users b ON b.id = c.buyer_id
     JOIN users s ON s.id = c.seller_id
     LEFT JOIN slabs sl ON sl.id = c.slab_id
     LEFT JOIN card_models m ON m.id = sl.card_model_id
     LEFT JOIN messages msg ON msg.id = r.message_id
     LEFT JOIN users mu ON mu.id = msg.sender_id
     WHERE r.status = ?
     ORDER BY r.created_at DESC
     LIMIT 100`
  ).bind(status).all();
  const out = [];
  for (const r of rows.results || []) {
    const ctx = await env.DB.prepare(
      `SELECT mm.id, mm.body, mm.created_at, mm.warning, mm.warning_codes, u.username AS sender_username
       FROM messages mm JOIN users u ON u.id = mm.sender_id WHERE mm.conversation_id = ? ORDER BY mm.rowid DESC LIMIT 20`
    ).bind(r.conversation_id).all();
    out.push({
      id: r.id, status: r.status, reason: r.reason, note: r.note, created_at: r.created_at,
      reporter_username: r.reporter_username,
      conversation: { id: r.conversation_id, listing_id: r.listing_id, slab_id: r.slab_id, card_name: r.card_name,
                      buyer_id: r.buyer_id, seller_id: r.seller_id, buyer_username: r.buyer_username, seller_username: r.seller_username },
      message: r.message_id ? { id: r.message_id, body: r.message_body, created_at: r.message_created_at, sender_username: r.message_sender_username } : null,
      context: (ctx.results || []).reverse().map((m) => ({ id: m.id, sender_username: m.sender_username, body: m.body, created_at: m.created_at,
                                                         warning: !!m.warning, warning_codes: m.warning_codes ? m.warning_codes.split(",") : [] }))
    });
  }
  return J({ reports: out });
}

async function adminResolveReport(env, request, user, id, h) {
  const body = await h.readJson(request) || {};
  const status = body.status === "open" ? "open" : "closed";
  const r = await env.DB.prepare("UPDATE chat_reports SET status = ? WHERE id = ?").bind(status, id).run();
  if (!r.meta || !r.meta.changes) return err(404, "not_found", "Segnalazione non trovata");
  await h.audit(env, user.id, "chat_report_" + status, "chat_report", id, { note: cleanMessage(body.note).slice(0, 300) || null });
  return J({ ok: true, status });
}
