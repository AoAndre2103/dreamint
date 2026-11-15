/**
 * v32: passaggio di una carta NON gradata venduta fuori DreaMint.
 * Il codice è un segreto monouso consegnato dal venditore al compratore;
 * non è un pagamento, certificato di autenticità o attestazione di consegna.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 simboli, senza I/O/0/1
const VALIDITY_DAYS = 30;
const PENDING_SALES = "('requested','accepted','paid','shipped')";
const OPEN_LISTINGS = "('active','reserved','paused')";

function J(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export function createRawTransferCode() {
  // 20 * 5 bit = 100 bit di entropia. Il codice completo non è mai salvato nel DB.
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const chars = Array.from(bytes, (b) => ALPHABET[b & 31]).join('');
  return 'DMU-' + chars.match(/.{5}/g).join('-');
}

export function normalizeRawTransferCode(s) {
  return String(s || '').trim().toUpperCase().replace(/[\s-]/g, '');
}

async function hashCode(s) {
  const data = new TextEncoder().encode(normalizeRawTransferCode(s));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function validOwnerSql(alias = 's') {
  return `${alias}.is_ungraded = 1 AND ${alias}.status IN ('approved','listed') ` +
    `AND (${alias}.archived_at IS NULL OR ${alias}.archived_reason = 'sold_outside')`;
}
function noPendingSql(alias = 's') {
  return `NOT EXISTS (SELECT 1 FROM listings li WHERE li.slab_id = ${alias}.id AND li.status IN ${OPEN_LISTINGS}) ` +
    `AND NOT EXISTS (SELECT 1 FROM sales sa WHERE sa.slab_id = ${alias}.id AND sa.status IN ${PENDING_SALES})`;
}

async function eligible(request, env, helpers) {
  const user = await helpers.requireUser(request, env);
  const rows = await env.DB.prepare(
    `SELECT s.id, m.name AS card_name, m.set_name, m.code_printed, s.status,
            s.archived_at, s.archived_reason,
            EXISTS (SELECT 1 FROM listings li WHERE li.slab_id = s.id AND li.status IN ${OPEN_LISTINGS}) AS listing_open,
            EXISTS (SELECT 1 FROM sales sa WHERE sa.slab_id = s.id AND sa.status IN ${PENDING_SALES}) AS sale_open,
            CASE WHEN rt.expires_at > ? THEN 1 ELSE 0 END AS code_valid
       FROM slabs s JOIN card_models m ON m.id = s.card_model_id
       LEFT JOIN ungraded_transfer_codes rt ON rt.slab_id = s.id AND rt.owner_id = ?
       WHERE s.physical_owner_id = ? AND ${validOwnerSql()}
       ORDER BY s.created_at DESC LIMIT 300`
  ).bind(new Date().toISOString(), user.id, user.id).all();
  return J({ cards: (rows.results || []).map((r) => ({ ...r, listing_open: !!r.listing_open,
    sale_open: !!r.sale_open, code_valid: !!r.code_valid })) });
}

async function generate(request, env, helpers, id) {
  const user = await helpers.requireUser(request, env);
  const slab = await env.DB.prepare(
    `SELECT s.id, s.is_ungraded, s.status, s.archived_at, s.archived_reason,
            s.physical_owner_id FROM slabs s WHERE s.id = ?`
  ).bind(id).first();
  if (!slab || slab.physical_owner_id !== user.id) return J({ error: 'Carta non trovata' }, 404);
  if (!slab.is_ungraded) return J({ error: 'Il codice per non gradate non si usa con le gradate' }, 400);
  if (!['approved', 'listed'].includes(slab.status) ||
      (slab.archived_at && slab.archived_reason !== 'sold_outside')) {
    return J({ error: 'Questa carta non può essere trasferita. Deve essere approvata e non eliminata.' }, 409);
  }
  const open = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM listings WHERE slab_id = ? AND status IN ${OPEN_LISTINGS}) AS listings,
            (SELECT COUNT(*) FROM sales WHERE slab_id = ? AND status IN ${PENDING_SALES}) AS sales`
  ).bind(id, id).first();
  if (open && (open.listings || open.sales)) {
    return J({ error: 'Chiudi prima l’annuncio e le vendite in corso. Il trasferimento fuori DreaMint non annulla una vendita aperta.', code: 'open_transactions' }, 409);
  }
  const code = createRawTransferCode();
  const hash = await hashCode(code);
  const now = new Date();
  const at = now.toISOString();
  const expires = new Date(now.getTime() + VALIDITY_DAYS * 86400000).toISOString();
  // Controlli ripetuti nell'INSERT: evita la generazione dopo un cambio proprietario
  // o durante l'apertura di una vendita concorrente.
  const result = await env.DB.prepare(
    `INSERT OR REPLACE INTO ungraded_transfer_codes
      (slab_id, owner_id, code_hash, created_at, expires_at)
     SELECT s.id, ?, ?, ?, ? FROM slabs s
     WHERE s.id = ? AND s.physical_owner_id = ? AND ${validOwnerSql()} AND ${noPendingSql()}`
  ).bind(user.id, hash, at, expires, id, user.id).run();
  if (!(result.meta && result.meta.changes)) return J({ error: 'Carta non disponibile per il trasferimento', code: 'transfer_locked' }, 409);
  if (helpers.audit) await helpers.audit(env, user.id, 'raw_transfer_code_generated', 'slab', id, { expires_at: expires });
  return J({ ok: true, card_id: id, code, expires_at: expires,
    message: 'Invia questo codice soltanto al compratore. Il precedente, se esiste, non è più valido.' });
}

async function redeem(request, env, helpers) {
  const user = await helpers.requireUser(request, env);
  const body = await helpers.readJson(request);
  const normalized = normalizeRawTransferCode(body.code);
  if (!/^DMU[A-HJ-NP-Z2-9]{20}$/.test(normalized)) return J({ error: 'Codice non valido o scaduto' }, 400);
  const hash = await hashCode(normalized);
  const at = new Date().toISOString();
  const candidate = await env.DB.prepare(
    `SELECT rt.slab_id, rt.owner_id, rt.expires_at, s.physical_owner_id,
            s.is_ungraded, s.status, s.archived_at, s.archived_reason,
            m.name AS card_name, m.set_name, m.code_printed
       FROM ungraded_transfer_codes rt
       JOIN slabs s ON s.id = rt.slab_id
       JOIN card_models m ON m.id = s.card_model_id
       WHERE rt.code_hash = ? AND rt.expires_at > ? LIMIT 1`
  ).bind(hash, at).first();
  if (!candidate || candidate.owner_id !== candidate.physical_owner_id ||
      !candidate.is_ungraded || !['approved','listed'].includes(candidate.status) ||
      (candidate.archived_at && candidate.archived_reason !== 'sold_outside')) {
    return J({ error: 'Codice non valido o scaduto' }, 400);
  }
  if (candidate.owner_id === user.id) return J({ error: 'Sei già il proprietario di questa carta' }, 409);
  const historyId = crypto.randomUUID();
  // DB.batch è transazionale in D1. Il trasferimento avviene SOLO se hash,
  // proprietario e assenza di vendite sono ancora validi all'atto dell'UPDATE.
  const res = await env.DB.batch([
    env.DB.prepare(
      `UPDATE slabs SET physical_owner_id = ?, digital_owner_id = ?,
          archived_at = NULL, archived_reason = NULL,
          status = 'approved', asking_price_cents = NULL
       WHERE id = ? AND physical_owner_id = ? AND ${validOwnerSql('slabs')}
         AND EXISTS (SELECT 1 FROM ungraded_transfer_codes rt WHERE
           rt.slab_id = slabs.id AND rt.owner_id = slabs.physical_owner_id
           AND rt.code_hash = ? AND rt.expires_at > ?)
         AND ${noPendingSql('slabs')}`
    ).bind(user.id, user.id, candidate.slab_id, candidate.owner_id, hash, at),
    env.DB.prepare(
      `INSERT INTO slab_owner_history (id, slab_id, from_user_id, to_user_id, reason, sale_id, created_at, part)
       SELECT ?, ?, ?, ?, 'raw_transfer_code', NULL, ?, 'physical' WHERE changes() > 0`
    ).bind(historyId, candidate.slab_id, candidate.owner_id, user.id, at),
    env.DB.prepare(
      `DELETE FROM ungraded_transfer_codes WHERE slab_id = ? AND owner_id = ? AND code_hash = ?
       AND EXISTS (SELECT 1 FROM slab_owner_history WHERE id = ?)`
    ).bind(candidate.slab_id, candidate.owner_id, hash, historyId),
    env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, payload, created_at)
       SELECT ?, ?, 'raw_transfer_redeemed', 'slab', ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM slab_owner_history WHERE id = ?)`
    ).bind(crypto.randomUUID(), user.id, candidate.slab_id,
      JSON.stringify({ from_user_id: candidate.owner_id, to_user_id: user.id, method: 'off_platform_code' }), at, historyId)
  ]);
  if (!(res[0].meta && res[0].meta.changes)) return J({ error: 'Codice non più valido o carta con vendita in corso', code: 'transfer_locked' }, 409);
  return J({ ok: true, card_id: candidate.slab_id, card_name: candidate.card_name,
    set_name: candidate.set_name, code_printed: candidate.code_printed });
}

export async function handleUngradedTransfers(request, env, path, helpers) {
  const method = request.method.toUpperCase();
  if (method === 'GET' && path === 'ungraded-transfers/eligible') return eligible(request, env, helpers);
  if (method === 'POST' && path === 'ungraded-transfers/redeem') return redeem(request, env, helpers);
  const m = /^cards\/([^/]+)\/ungraded-transfer-code$/.exec(path);
  if (method === 'POST' && m) return generate(request, env, helpers, m[1]);
  return null;
}
