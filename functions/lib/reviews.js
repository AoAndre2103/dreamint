// v27: recensioni tra venditore e acquirente (solo vendite completate, una a testa).
// Regole: voto 1-5, commento facoltativo (max 500). Una recensione diventa pubblica quando hanno recensito
// entrambi OPPURE dopo REVIEW_REVEAL_DAYS giorni (così nessuno si vendica dopo aver letto l'altra).
// Si può recensire entro REVIEW_WINDOW_DAYS dal completamento. Le vendite con carte TEST non si recensiscono.
// Le funzioni usano solo l'API di D1 (prepare/bind/first/all/run), quindi si provano anche con SQLite locale.
export const REVIEW_COMMENT_MAX = 500;
export const REVIEW_REVEAL_DAYS = 14;
export const REVIEW_WINDOW_DAYS = 60;
const DAY_MS = 86400000;

export function cleanComment(v) {
  return String(v == null ? "" : v)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function validateReview(body) {
  const b = body && typeof body === "object" ? body : {};
  const r = b.rating;
  const okType = (typeof r === "number" && Number.isInteger(r)) || (typeof r === "string" && /^[1-5]$/.test(r));
  const rating = okType ? Number(r) : NaN;
  if (!(rating >= 1 && rating <= 5)) return { ok: false, code: "invalid_rating", error: "Scegli un voto da 1 a 5" };
  const comment = cleanComment(typeof b.comment === "string" ? b.comment : "");
  if (comment.length > REVIEW_COMMENT_MAX) {
    return { ok: false, code: "comment_too_long", error: "Il commento può avere al massimo " + REVIEW_COMMENT_MAX + " caratteri" };
  }
  return { ok: true, rating, comment: comment || null };
}

export function revealCutoffIso(now) {
  return new Date(now - REVIEW_REVEAL_DAYS * DAY_MS).toISOString();
}

// Visibile = non nascosta E (l'altra parte ha recensito la stessa vendita OPPURE è passato il periodo di attesa). Un solo "?" = cutoff.
const VISIBLE_SQL =
  "r.hidden_at IS NULL AND (r.created_at <= ? OR EXISTS (SELECT 1 FROM reviews c WHERE c.sale_id = r.sale_id AND c.reviewer_id = r.reviewee_id))";

function avg1(sum, n) { return n ? Math.round((sum / n) * 10) / 10 : null; }

export async function createReview(db, { saleId, userId, body, now = Date.now(), id }) {
  const v = validateReview(body);
  if (!v.ok) return { status: 400, body: { error: v.error, code: v.code } };
  const sale = await db.prepare(
    "SELECT sa.id, sa.seller_id, sa.buyer_id, sa.status, sa.received_at, sa.created_at, sl.is_test FROM sales sa JOIN slabs sl ON sl.id = sa.slab_id WHERE sa.id = ?"
  ).bind(saleId).first();
  if (!sale || (userId !== sale.seller_id && userId !== sale.buyer_id)) {
    return { status: 404, body: { error: "Vendita non trovata", code: "not_found" } };
  }
  if (sale.seller_id === sale.buyer_id) return { status: 409, body: { error: "Non puoi recensire te stesso", code: "self_review" } };
  if (sale.is_test) return { status: 409, body: { error: "Le vendite di prova non si possono recensire", code: "test_sale" } };
  if (sale.status !== "completed") {
    return { status: 409, body: { error: "Puoi recensire solo a vendita completata", code: "not_completed" } };
  }
  const doneAt = Date.parse(sale.received_at || sale.created_at);
  if (Number.isFinite(doneAt) && now - doneAt > REVIEW_WINDOW_DAYS * DAY_MS) {
    return { status: 409, body: { error: "Sono passati più di " + REVIEW_WINDOW_DAYS + " giorni dalla vendita", code: "window_closed" } };
  }
  const dup = await db.prepare("SELECT id FROM reviews WHERE sale_id = ? AND reviewer_id = ?").bind(saleId, userId).first();
  if (dup) return { status: 409, body: { error: "Hai già recensito questa vendita", code: "already_reviewed" } };
  const iAmSeller = userId === sale.seller_id;
  const revieweeId = iAmSeller ? sale.buyer_id : sale.seller_id;
  const revieweeRole = iAmSeller ? "buyer" : "seller";
  const rid = id || crypto.randomUUID();
  const at = new Date(now).toISOString();
  try {
    await db.prepare(
      "INSERT INTO reviews (id, sale_id, reviewer_id, reviewee_id, reviewee_role, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(rid, saleId, userId, revieweeId, revieweeRole, v.rating, v.comment, at).run();
  } catch (e) {
    return { status: 409, body: { error: "Hai già recensito questa vendita", code: "already_reviewed" } };
  }
  return {
    status: 201,
    body: { ok: true, review: { id: rid, rating: v.rating, comment: v.comment, reviewee_role: revieweeRole, created_at: at } },
    reviewee_id: revieweeId
  };
}

export async function listUserReviews(db, userId, { now = Date.now(), limit = 30 } = {}) {
  const cutoff = revealCutoffIso(now);
  const agg = await db.prepare(
    `SELECT r.reviewee_role AS role, COUNT(*) AS n, SUM(r.rating) AS total FROM reviews r WHERE r.reviewee_id = ? AND ${VISIBLE_SQL} GROUP BY r.reviewee_role`
  ).bind(userId, cutoff).all();
  const by = { seller: { n: 0, total: 0 }, buyer: { n: 0, total: 0 } };
  for (const row of agg.results || []) if (by[row.role]) by[row.role] = { n: Number(row.n), total: Number(row.total) };
  const n = by.seller.n + by.buyer.n;
  const summary = {
    count: n,
    avg: avg1(by.seller.total + by.buyer.total, n),
    as_seller: { count: by.seller.n, avg: avg1(by.seller.total, by.seller.n) },
    as_buyer: { count: by.buyer.n, avg: avg1(by.buyer.total, by.buyer.n) }
  };
  const rows = await db.prepare(
    `SELECT r.id, r.rating, r.comment, r.reviewee_role, r.created_at, u.username AS reviewer_username
       FROM reviews r JOIN users u ON u.id = r.reviewer_id
      WHERE r.reviewee_id = ? AND ${VISIBLE_SQL}
      ORDER BY r.created_at DESC LIMIT ?`
  ).bind(userId, cutoff, Math.max(1, Math.min(100, limit | 0))).all();
  return { summary, reviews: rows.results || [] };
}

// Per la pagina «Vendite»: per ogni vendita completata, la mia recensione (se c'è) e se posso ancora scriverla.
export async function reviewStatusForSales(db, saleIds, userId, now = Date.now()) {
  const out = {};
  const ids = Array.from(new Set(saleIds || []));
  for (let i = 0; i < ids.length; i += 40) {
    const part = ids.slice(i, i + 40);
    const rows = await db.prepare(
      `SELECT sa.id, sa.received_at, sa.created_at, sl.is_test,
              (SELECT rating FROM reviews WHERE sale_id = sa.id AND reviewer_id = ?) AS my_rating,
              (SELECT comment FROM reviews WHERE sale_id = sa.id AND reviewer_id = ?) AS my_comment,
              (SELECT created_at FROM reviews WHERE sale_id = sa.id AND reviewer_id = ?) AS my_at
         FROM sales sa JOIN slabs sl ON sl.id = sa.slab_id
        WHERE sa.id IN (${part.map(() => "?").join(",")})`
    ).bind(userId, userId, userId, ...part).all();
    for (const r of rows.results || []) {
      const doneAt = Date.parse(r.received_at || r.created_at);
      const open = !r.is_test && !(Number.isFinite(doneAt) && now - doneAt > REVIEW_WINDOW_DAYS * DAY_MS);
      out[r.id] = {
        mine: r.my_rating != null ? { rating: Number(r.my_rating), comment: r.my_comment || null, created_at: r.my_at } : null,
        can_review: r.my_rating == null && open
      };
    }
  }
  return out;
}

export async function hideReview(db, reviewId, adminId, now = Date.now()) {
  const r = await db.prepare("SELECT id, hidden_at FROM reviews WHERE id = ?").bind(reviewId).first();
  if (!r) return { status: 404, body: { error: "Recensione non trovata", code: "not_found" } };
  if (r.hidden_at) return { status: 409, body: { error: "Recensione già nascosta", code: "already_hidden" } };
  await db.prepare("UPDATE reviews SET hidden_at = ?, hidden_by = ? WHERE id = ?").bind(new Date(now).toISOString(), adminId, reviewId).run();
  return { status: 200, body: { ok: true } };
}
