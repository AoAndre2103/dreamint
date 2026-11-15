// Regression: a legacy Gengar uploaded without a back photo must be removable by its
// owner, without allowing deletion of someone else's card or a completed digital mint.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch (_) { /* Node <22 */ }
const dbTest = (name, fn) => test(name, { skip: DatabaseSync ? false : 'requires node:sqlite' }, fn);
const api = DatabaseSync ? await import('../functions/api/[[path]].js') : null;
const iso = (d) => new Date(d).toISOString();

function d1(db) {
  return {
    prepare(sql) {
      const st = db.prepare(sql);
      let args = [];
      const p = {
        bind(...a) { args = a; return p; },
        async first() { return st.get(...args) || null; },
        async all() { return { results: st.all(...args) }; },
        async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes) } }; }
      };
      return p;
    },
    async batch(stmts) {
      db.exec('BEGIN');
      try { const out = []; for (const st of stmts) out.push(await st.run()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  };
}
let seq = 0;
function insert(db, table, values) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const row = { ...values };
  for (const c of cols) {
    if (row[c.name] === undefined && c.notnull && c.dflt_value == null && !c.pk) {
      row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : 'fixture' + (++seq);
    }
  }
  const names = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((k) => row[k]));
}
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  for (const id of ['owner', 'other']) {
    insert(db, 'users', { id, email: id + '@example.test', username: 'user_' + id, display_name: id,
      email_verified_at: iso(Date.now()), created_at: iso(Date.now()) });
    insert(db, 'sessions', { token_hash: crypto.createHash('sha256').update('token-' + id).digest('hex'),
      user_id: id, expires_at: iso(Date.now() + 86400000) });
  }
  const keys = new Set(['photo:gengar-review:front', 'photo:gengar-rejected:front',
    'photo:gengar-approved:front', 'photo:gengar-minted:front', 'photo:gengar-with-back:front',
    'photo:gengar-with-back:back', 'photo:raw-open:front', 'photo:raw-open:back']);
  const env = { DB: d1(db), PHOTOS: { async list({ prefix }) {
    return { keys: [...keys].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) };
  } } };
  return { db, env };
}
function card(db, id, options = {}) {
  const raw = options.raw || false;
  insert(db, 'slabs', {
    id, card_model_id: 'm_drago_ita', submitter_id: options.owner || 'owner',
    physical_owner_id: options.owner || 'owner', digital_owner_id: options.owner || 'owner',
    grader: raw ? 'NONE' : 'PSA', certificate_no: raw ? 'RAW-' + id : 'GENGAR-' + id,
    is_ungraded: raw ? 1 : 0, status: options.status || 'in_review',
    assigned_at: options.minted ? iso(Date.now()) : null,
    rarity_tier: options.minted ? 'rara' : null,
    serial_number: options.minted ? (id === 'gengar-with-back' ? 8 : 7) : null,
    opened_at: options.opened ? iso(Date.now()) : null,
    server_seed: 'seed', commit_hash: 'hash', client_nonce: 'nonce', created_at: iso(Date.now()), is_test: 0
  });
}
async function call(env, method, path, who = 'owner', origin) {
  const h = {};
  if (who) h.cookie = 'gemint_sid=token-' + who;
  if (origin) h.origin = origin;
  const result = await api.onRequest({ env, request: new Request('https://dreamint.test/api/' + path,
    { method, headers: h }) });
  return { status: result.status, data: await result.json() };
}

dbTest('Gengar in review without a back: owner removes it, archive/audit, absent from album and detail', async () => {
  const { db, env } = setup();
  card(db, 'gengar-review');
  const before = await call(env, 'GET', 'cards/gengar-review');
  assert.equal(before.status, 200, JSON.stringify(before.data));
  assert.equal(before.data.card.missing_back, true);
  assert.equal(before.data.card.can_remove, true);
  const r = await call(env, 'DELETE', 'cards/gengar-review');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.archived_reason, 'owner_removed');
  const saved = db.prepare("SELECT archived_at, archived_reason, certificate_no FROM slabs WHERE id = 'gengar-review'").get();
  assert.ok(saved.archived_at);
  assert.equal(saved.archived_reason, 'owner_removed');
  assert.equal(saved.certificate_no, 'REMOVED-gengar-review', 'old unapproved certificate is freed');
  assert.equal(db.prepare("SELECT count(*) n FROM audit_logs WHERE action='owner_remove_card' AND entity_id='gengar-review'").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM slab_owner_history WHERE slab_id='gengar-review' AND reason='owner_removed'").get().n, 1);
  assert.equal((await call(env, 'GET', 'cards/gengar-review')).status, 404);
  assert.equal((await call(env, 'GET', 'public/cards/gengar-review', null)).status, 404);
  assert.equal((await call(env, 'GET', 'cards')).data.cards.some((c) => c.id === 'gengar-review'), false);
  assert.equal((await call(env, 'DELETE', 'cards/gengar-review')).status, 409);
  card(db, 'second-submission');
  db.prepare("UPDATE slabs SET certificate_no = 'GENGAR-gengar-review' WHERE id = 'second-submission'").run();
  assert.equal(db.prepare("SELECT certificate_no FROM slabs WHERE id='second-submission'").get().certificate_no, 'GENGAR-gengar-review');
});

dbTest('rejected registration without back is removable, others cannot delete it', async () => {
  const { db, env } = setup();
  card(db, 'gengar-rejected', { status: 'rejected' });
  assert.equal((await call(env, 'DELETE', 'cards/gengar-rejected', null)).status, 401);
  assert.equal((await call(env, 'DELETE', 'cards/gengar-rejected', 'other')).status, 404);
  assert.equal((await call(env, 'DELETE', 'cards/gengar-rejected', 'owner', 'https://evil.test')).status, 403);
  assert.equal((await call(env, 'DELETE', 'cards/gengar-rejected')).status, 200);
  assert.equal((await call(env, 'DELETE', 'cards/not-existing')).status, 404);
});

dbTest('approved legacy Gengar missing back: removable before opening; approved with back is protected', async () => {
  const { db, env } = setup();
  card(db, 'gengar-approved', { status: 'approved', minted: true });
  const before = await call(env, 'GET', 'cards/gengar-approved');
  assert.equal(before.data.card.can_remove, true);
  const r = await call(env, 'DELETE', 'cards/gengar-approved');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(db.prepare("SELECT certificate_no FROM slabs WHERE id='gengar-approved'").get().certificate_no,
    'GENGAR-gengar-approved', 'approved/minted certificate must stay reserved');
  const audit = JSON.parse(db.prepare("SELECT payload FROM audit_logs WHERE entity_id='gengar-approved'").get().payload);
  assert.equal(audit.legacy_missing_back, true);
  card(db, 'gengar-with-back', { status: 'approved', minted: true });
  assert.equal((await call(env, 'GET', 'cards/gengar-with-back')).data.card.can_remove, false);
  assert.equal((await call(env, 'DELETE', 'cards/gengar-with-back')).status, 409);
  assert.equal(db.prepare("SELECT archived_at FROM slabs WHERE id='gengar-with-back'").get().archived_at, null);
});

dbTest('opened graded card cannot be deleted even if back is missing', async () => {
  const { db, env } = setup();
  card(db, 'gengar-minted', { status: 'approved', minted: true, opened: true });
  assert.equal((await call(env, 'GET', 'cards/gengar-minted')).data.card.can_remove, false);
  assert.equal((await call(env, 'DELETE', 'cards/gengar-minted')).status, 409);
  assert.equal(db.prepare("SELECT archived_at FROM slabs WHERE id='gengar-minted'").get().archived_at, null);
});

dbTest('raw card: active listing or paid sale blocks removal', async () => {
  const { db, env } = setup();
  card(db, 'raw-open', { raw: true, status: 'approved' });
  assert.equal((await call(env, 'DELETE', 'cards/raw-open')).status, 200);
  card(db, 'raw-listed', { raw: true, status: 'listed' });
  insert(db, 'listings', { id: 'listing-raw', slab_id: 'raw-listed', seller_id: 'owner',
    price_cents: 1000, status: 'active', created_at: iso(Date.now()) });
  assert.equal((await call(env, 'DELETE', 'cards/raw-listed')).status, 409);
  assert.equal(db.prepare("SELECT archived_at FROM slabs WHERE id='raw-listed'").get().archived_at, null);
  db.prepare("UPDATE listings SET status = 'cancelled' WHERE id = 'listing-raw'").run();
  insert(db, 'sales', { id: 'sale-raw', listing_id: 'listing-raw', slab_id: 'raw-listed', seller_id: 'owner',
    buyer_id: 'other', status: 'paid', price_cents: 1000, created_at: iso(Date.now()) });
  assert.equal((await call(env, 'DELETE', 'cards/raw-listed')).status, 409);
  assert.equal(db.prepare("SELECT archived_at FROM slabs WHERE id='raw-listed'").get().archived_at, null);
});

test('client: delete-card is bound on album and detail, and translated both IT/EN', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const lang = fs.readFileSync(new URL('../public/js/i18n.js', import.meta.url), 'utf8');
  assert.equal((app.match(/bindRemoveCardButtons\(\$app\);/g) || []).length, 2);
  assert.match(app, /data-remove-card/);
  assert.match(app, /method: "DELETE"/);
  for (const key of ['card.removeBtn', 'card.removeConfirm', 'card.removeHint', 'card.removeOk', 'card.removeError']) {
    assert.equal((lang.match(new RegExp('"' + key.replace('.', '\\.') + '":', 'g')) || []).length, 2);
  }
});
