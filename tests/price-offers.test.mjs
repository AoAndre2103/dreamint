// v30: proposte ricevute dai venditori, risposta, conversione in vendita reale.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch (_) {}
const dbTest = (name, fn) => test(name, { skip: !DatabaseSync && 'requires Node 22+' }, fn);
const api = DatabaseSync ? await import('../functions/api/[[path]].js') : null;
const now = () => new Date().toISOString();
let seq = 0;
function insert(db, table, values) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all(), row = { ...values };
  for (const c of cols) if (row[c.name] === undefined && c.notnull && c.dflt_value == null && !c.pk)
    row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : 'auto-' + (++seq);
  const names = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`)
    .run(...names.map(k => row[k]));
}
function d1(db) {
  return {
    prepare(sql) {
      const st = db.prepare(sql); let args = [];
      const q = {
        bind(...a) { args = a; return q; },
        async first() { return st.get(...args) || null; },
        async all() { return { results: st.all(...args) }; },
        async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes) } }; }
      };
      return q;
    },
    async batch(stmts) {
      db.exec('BEGIN');
      try { const out = []; for (const q of stmts) out.push(await q.run()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  };
}
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const env = { DB: d1(db) };
  for (const id of ['seller', 'buyer', 'other']) {
    insert(db, 'users', { id, email: id + '@example.test', display_name: id, username: 'tcg' + id,
      created_at: now(), email_verified_at: now() });
    insert(db, 'sessions', { token_hash: crypto.createHash('sha256').update('token-' + id).digest('hex'),
      user_id: id, expires_at: new Date(Date.now() + 86400000).toISOString() });
  }
  insert(db, 'card_models', { id: 'm1', game: 'pokemon', set_name: 'Test', name: 'Gengar',
    code_printed: '025/100', code_normalized: '025100', language: 'ITA', variant: 'normal',
    slug: 'test-gengar', created_at: now() });
  insert(db, 'slabs', { id: 'gengar', card_model_id: 'm1', is_ungraded: 1, status: 'listed',
    physical_owner_id: 'seller', digital_owner_id: 'seller', is_test: 0, archived_at: null,
    asking_price_cents: 5000 });
  insert(db, 'listings', { id: 'listing1', slab_id: 'gengar', seller_id: 'seller',
    status: 'active', price_cents: 5000, created_at: now() });
  return { db, env };
}
async function call(env, path, who, body, method = 'POST') {
  const headers = { 'content-type': 'application/json' };
  if (who) headers.cookie = 'gemint_sid=token-' + who;
  const result = await api.onRequest({ env, request: new Request('https://dreamint.test/api/' + path,
    { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) });
  return { status: result.status, body: await result.json() };
}
const shipping = { contact: 'buyer@example.test', shipping_method: 'inpost_locker',
  shipping_dest: { name: 'Destinatario', phone: '3331234567', point_code: 'BOX-123' } };

// Full happy path: proposal -> seller inbox -> accept -> buyer checkout at agreed price -> normal sale.
dbTest('proposta dalla pagina carta: arriva al venditore, accettazione e checkout al prezzo offerto', async () => {
  const { db, env } = setup();
  const submitted = await call(env, 'listings/listing1/offers', 'buyer', { offer_euros: '30,00', message: 'Va bene 30?' });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  const id = submitted.body.offer.id;
  const sellerView = await call(env, 'offers', 'seller', undefined, 'GET');
  assert.equal(sellerView.body.offers.length, 1);
  assert.equal(sellerView.body.offers[0].offer_cents, 3000);
  assert.equal(sellerView.body.offers[0].buyer_name, 'buyer');
  assert.equal(sellerView.body.offers[0].card_name, 'Gengar');
  assert.equal(sellerView.body.offers[0].message, 'Va bene 30?');
  assert.equal((await call(env, 'offers', 'other', undefined, 'GET')).body.offers.length, 0);
  const accepted = await call(env, `offers/${id}/accept`, 'seller', {});
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.status, 'accepted');
  const checkout = await call(env, `offers/${id}/checkout`, 'buyer', shipping);
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(checkout.body.sale.id);
  assert.equal(sale.price_cents, 3000, 'prezzo negoziato, non quello dell’annuncio');
  assert.equal(sale.shipping_cents, 499);
  assert.equal(sale.total_cents, 3499);
  assert.equal(sale.status, 'accepted');
  assert.equal(db.prepare('SELECT status, sale_id FROM price_offers WHERE id = ?').get(id).sale_id, sale.id);
  assert.equal(db.prepare('SELECT status FROM listings WHERE id = ?').get('listing1').status, 'active', 'non prenotare fino al pagamento');
  assert.equal((await call(env, `offers/${id}/checkout`, 'buyer', shipping)).status, 409, 'non creare due acquisti');
});

dbTest('il mercato segnala il proprio annuncio: il proprietario non vede il form Fai un’offerta', async () => {
  const { env } = setup();
  const mine = await call(env, 'market', 'seller', undefined, 'GET');
  const other = await call(env, 'market', 'buyer', undefined, 'GET');
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.equal(other.status, 200, JSON.stringify(other.body));
  assert.equal(mine.body.listings.find(l => l.id === 'listing1').mine, true);
  assert.equal(other.body.listings.find(l => l.id === 'listing1').mine, false);
});

dbTest('protezione permessi: solo acquirente propone e completa, solo venditore risponde', async () => {
  const { env } = setup();
  assert.equal((await call(env, 'listings/listing1/offers', null, { offer_euros: 10 })).status, 401);
  assert.equal((await call(env, 'listings/listing1/offers', 'seller', { offer_euros: 10 })).status, 403);
  assert.equal((await call(env, 'listings/listing1/offers', 'buyer', { offer_euros: 100 })).status, 400);
  assert.equal((await call(env, 'listings/listing1/offers', 'buyer', { offer_euros: 0.1 })).status, 400);
  const offer = await call(env, 'listings/listing1/offers', 'buyer', { offer_euros: 20 });
  assert.equal(offer.status, 201);
  const id = offer.body.offer.id;
  assert.equal((await call(env, `offers/${id}/accept`, 'other', {})).status, 403);
  assert.equal((await call(env, `offers/${id}/accept`, 'buyer', {})).status, 403);
  assert.equal((await call(env, `offers/${id}/checkout`, 'buyer', shipping)).status, 409, 'serve accettazione');
  assert.equal((await call(env, `offers/${id}/accept`, 'seller', {})).status, 200);
  assert.equal((await call(env, `offers/${id}/checkout`, 'seller', shipping)).status, 403);
  assert.equal((await call(env, `offers/${id}/checkout`, 'other', shipping)).status, 403);
});

dbTest('offerte duplicate bloccate, rifiuto e annullamento permettono una nuova proposta', async () => {
  const { env } = setup();
  const a = await call(env, 'listings/listing1/offers', 'buyer', { offer_euros: 15 });
  const id = a.body.offer.id;
  assert.equal((await call(env, 'listings/listing1/offers', 'buyer', { offer_euros: 16 })).status, 409);
  assert.equal((await call(env, `offers/${id}/reject`, 'seller', {})).status, 200);
  assert.equal((await call(env, `offers/${id}/accept`, 'seller', {})).status, 409);
  const b = await call(env, 'listings/listing1/offers', 'buyer', { offer_euros: 17 });
  assert.equal(b.status, 201);
  assert.equal((await call(env, `offers/${b.body.offer.id}/cancel`, 'buyer', {})).status, 200);
  assert.equal((await call(env, `offers/${b.body.offer.id}/accept`, 'seller', {})).status, 409);
  assert.equal((await call(env, 'listings/listing1/offers', 'buyer', { offer_euros: 18 })).status, 201);
});

dbTest('filtro per ID rende raggiungibili anche annunci non presenti nei primi 100', async () => {
  const { env } = setup();
  const result = await call(env, 'market?listing_id=listing1', 'buyer', undefined, 'GET');
  assert.equal(result.status, 200);
  assert.equal(result.body.listings.length, 1);
  assert.equal(result.body.listings[0].id, 'listing1');
  assert.equal((await call(env, 'market?listing_id=other', 'buyer', undefined, 'GET')).body.listings.length, 0);
  assert.equal((await call(env, 'market?listing_id=%3Cscript%3E', 'buyer', undefined, 'GET')).status, 400);
});

dbTest('annuncio chiuso non accetta offerte e impedisce un checkout già accettato', async () => {
  const { env, db } = setup();
  const a = await call(env, 'listings/listing1/offers', 'buyer', { offer_euros: 22 });
  const id = a.body.offer.id;
  assert.equal((await call(env, `offers/${id}/accept`, 'seller', {})).status, 200);
  db.prepare("UPDATE listings SET status = 'closed' WHERE id = 'listing1'").run();
  assert.equal((await call(env, `offers/${id}/checkout`, 'buyer', shipping)).status, 409);
  assert.equal((await call(env, 'listings/listing1/offers', 'other', { offer_euros: 19 })).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 0);
});

dbTest('rifiuta chi prova a pagare con spedizione incompleta e mantiene l’offerta accettata', async () => {
  const { env, db } = setup();
  const a = await call(env, 'listings/listing1/offers', 'buyer', { offer_euros: 24 });
  const id = a.body.offer.id;
  await call(env, `offers/${id}/accept`, 'seller', {});
  const bad = await call(env, `offers/${id}/checkout`, 'buyer', { shipping_method: 'poste_home' });
  assert.equal(bad.status, 400);
  assert.equal(db.prepare('SELECT status FROM price_offers WHERE id = ?').get(id).status, 'accepted');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 0);
});

test('UI offerte, notifiche, route e migrazione vengono distribuite insieme', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../functions/api/[[path]].js', import.meta.url), 'utf8');
  const deploy = fs.readFileSync(new URL('../DEPLOY.sh', import.meta.url), 'utf8');
  const migration = fs.readFileSync(new URL('../migrate-v30.sql', import.meta.url), 'utf8');
  assert.match(app, /function priceOfferPanel/);
  assert.match(app, /function pagePriceOffers/);
  assert.match(app, /bindPriceOfferActions\(\$app\)/);
  assert.match(app, /offer_euros/);
  assert.match(app, /"\/checkout"/);
  assert.match(server, /sendNotifyEmail\(env, \{ to: person.email/);
  assert.match(server, /INSERT INTO sales \(id, listing_id, slab_id/);
  assert.match(deploy, /migrate-v30\.sql\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS price_offers/);
});
