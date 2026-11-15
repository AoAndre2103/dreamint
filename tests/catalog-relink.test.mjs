// v29: il proprietario corregge la stampa Pokémon di una carta già caricata,
// senza cancellare l'annuncio o perdere le foto. Test API reale con SQLite.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { priceCardRef } from '../functions/lib/price-history.js';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch (_) {}
const api = DatabaseSync ? await import('../functions/api/[[path]].js') : null;
const dbTest = (name, fn) => test(name, { skip: !DatabaseSync && 'requires Node 22+' }, fn);
const iso = () => new Date().toISOString();
let seq = 0;
function insert(db, table, values) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const row = { ...values };
  for (const c of columns) {
    if (row[c.name] === undefined && c.notnull && c.dflt_value == null && !c.pk) {
      row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : 'auto-' + (++seq);
    }
  }
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k]));
}
function d1(db) {
  return {
    prepare(sql) {
      const st = db.prepare(sql); let args = [];
      const q = {
        bind(...x) { args = x; return q; },
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
  const kv = new Map([['photo:raw1:front', 'FRONT'], ['photo:raw1:back', 'BACK']]);
  const env = { DB: d1(db), PHOTOS: {
    async get(k) { return kv.get(k) || null; },
    async put(k, v) { kv.set(k, v); },
    async list({ prefix }) { return { keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; }
  } };
  for (const who of ['owner', 'other']) {
    insert(db, 'users', { id: who, email: `${who}@example.test`, username: who + '99', display_name: who, created_at: iso() });
    insert(db, 'sessions', { token_hash: crypto.createHash('sha256').update('token-' + who).digest('hex'),
      user_id: who, expires_at: new Date(Date.now() + 86400000).toISOString() });
  }
  insert(db, 'card_models', { id: 'manual', game: 'pokemon', set_name: 'Inserito a mano', name: 'Gengar', code_printed: '025', code_normalized: '025', language: 'ITA', variant: 'normal', slug: 'manual', created_at: iso() });
  insert(db, 'slabs', { id: 'raw1', card_model_id: 'manual', is_ungraded: 1, status: 'listed', physical_owner_id: 'owner', digital_owner_id: 'owner', card_condition: 'EX', asking_price_cents: 4321, cardmarket_avg_cents: 3333, archived_at: null });
  insert(db, 'slabs', { id: 'raw2', card_model_id: 'manual', is_ungraded: 1, status: 'approved', physical_owner_id: 'other', digital_owner_id: 'other', archived_at: null });
  insert(db, 'slabs', { id: 'graded', card_model_id: 'manual', is_ungraded: 0, status: 'approved', physical_owner_id: 'owner', digital_owner_id: 'owner', assigned_at: iso(), rarity_tier: 'comune', opened_at: iso(), archived_at: null });
  insert(db, 'listings', { id: 'live-listing', slab_id: 'raw1', seller_id: 'owner', status: 'active', price_cents: 4321, shipping_note: 'Ritiro a mano', created_at: iso() });
  return { db, env, kv };
}
async function patch(env, card, who, body) {
  const headers = { 'content-type': 'application/json' };
  if (who) headers.cookie = 'gemint_sid=token-' + who;
  const resp = await api.onRequest({ request: new Request(`https://dreamint.test/api/cards/${card}/catalog`, {
    method: 'PATCH', headers, body: JSON.stringify(body)
  }), env });
  return { status: resp.status, body: await resp.json() };
}
const valid = { catalog_id: 'pokemon:swsh4-25', language: 'ITA', variant: 'normal', condition: 'NM' };
async function mockedTcgdex(fn, pricing = { trend: 18.5, avg7: 17.25, avg30: 15.0 }) {
  const prev = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    const lang = url.includes('/en/') ? 'en' : 'it';
    const card = {
      id: 'swsh4-25', name: lang === 'en' ? 'Gengar' : 'Gengar', localId: '25',
      set: { id: 'swsh4', symbol: 'swsh4', name: 'Voltaggio Sfolgorante', cardCount: { official: 185 } },
      image: `https://assets.tcgdex.net/${lang}/swsh/swsh4/25`,
      pricing: pricing ? { cardmarket: pricing } : undefined
    };
    return { ok: true, status: 200, text: async () => JSON.stringify(card) };
  };
  try { return await fn(urls); } finally { globalThis.fetch = prev; }
}

dbTest('carta non gradata in vendita: aggiorna stampa e condizione, NON prezzo/foto/annuncio; grafico collegato', async () => {
  const { db, env, kv } = setup();
  await mockedTcgdex(async (urls) => {
    const res = await patch(env, 'raw1', 'owner', valid);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.linked_catalog_id, valid.catalog_id);
    assert.equal(res.body.price_available, true);
    assert.equal(res.body.card.model.set_name, 'Voltaggio Sfolgorante');
    assert.equal(res.body.card.model.code_printed, '25/185');
    assert.equal(res.body.card.card_condition, 'NM');
    assert.equal(res.body.card.cardmarket_avg_cents, 1850);
    assert.equal(res.body.card.can_edit_catalog, true);
    assert.ok(urls.some((u) => u.includes('/it/cards/swsh4-25')));
  });
  const old = db.prepare('SELECT card_model_id FROM slabs WHERE id = ?').get('raw2');
  const newCard = db.prepare('SELECT * FROM slabs WHERE id = ?').get('raw1');
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get('live-listing');
  assert.equal(old.card_model_id, 'manual', 'il modello di un altro utente non cambia');
  assert.notEqual(newCard.card_model_id, 'manual');
  assert.equal(newCard.asking_price_cents, 4321);
  assert.equal(listing.price_cents, 4321);
  assert.equal(listing.shipping_note, 'Ritiro a mano');
  assert.equal(listing.status, 'active');
  assert.equal(kv.get('photo:raw1:front'), 'FRONT');
  assert.equal(kv.get('photo:raw1:back'), 'BACK');
  const linked = db.prepare('SELECT * FROM card_models WHERE id = ?').get(newCard.card_model_id);
  assert.match(linked.catalog_image, /assets\.tcgdex\.net\/it\/swsh\/swsh4\/25\/high\.webp/);
  const price = db.prepare('SELECT card_ref, price_cents FROM price_history WHERE game = ?').get('pokemon');
  assert.ok(price);
  assert.equal(price.card_ref, priceCardRef(linked), 'andamento prezzi sul modello effettivamente associato');
  assert.equal(price.price_cents, 1850);
  const trendResponse = await api.onRequest({ request: new Request('https://dreamint.test/api/prices/trend?slab_id=raw1&refresh=0'), env });
  const trend = (await trendResponse.json()).trend;
  assert.equal(trendResponse.status, 200);
  assert.equal(trend.card_ref, priceCardRef(linked));
  assert.equal(trend.last_cents, 1850);
  assert.ok(trend.windows && trend.windows.avg7 === 17.25);
  assert.equal(db.prepare('SELECT count(*) AS n FROM audit_logs WHERE action = ?').get('update_card_catalog').n, 1);
});

dbTest('nessuna selezione TCGdex, utente non proprietario, gradate certificate: blocco senza scritture', async () => {
  const { db, env } = setup();
  assert.equal((await patch(env, 'raw1', 'owner', { catalog_id: 'swsh4-25', language: 'ITA' })).status, 400);
  assert.equal((await patch(env, 'raw1', 'other', valid)).status, 404);
  assert.equal((await patch(env, 'raw1', null, valid)).status, 401);
  assert.equal((await patch(env, 'graded', 'owner', valid)).status, 409);
  assert.equal((await patch(env, 'raw1', 'owner', { ...valid, language: 'KOR' })).status, 400);
  assert.equal(db.prepare("SELECT card_model_id FROM slabs WHERE id='raw1'").get().card_model_id, 'manual');
});

dbTest('trattativa in corso: impedirne la correzione senza modificare l’annuncio', async () => {
  const { db, env } = setup();
  insert(db, 'sales', { id: 's1', listing_id: 'live-listing', slab_id: 'raw1', seller_id: 'owner', buyer_id: 'other', status: 'requested', created_at: iso() });
  const res = await patch(env, 'raw1', 'owner', valid);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'catalog_sale_locked');
  assert.equal(db.prepare("SELECT card_model_id FROM slabs WHERE id='raw1'").get().card_model_id, 'manual');
});

dbTest('TCGdex senza prezzi: collega la stampa ma non inventa lo storico Cardmarket', async () => {
  const { db, env } = setup();
  await mockedTcgdex(async () => {
    const res = await patch(env, 'raw1', 'owner', valid);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.price_available, false);
    assert.equal(res.body.card.cardmarket_avg_cents, null, 'non conservare media del vecchio modello');
  }, null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM price_history').get().n, 0);
});

dbTest('interfaccia: ricercare, scegliere una stampa e confermare; i link annuncio puntano alla modifica', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(app, /function catalogEditorHtml\(c\)/);
  assert.match(app, /function bindCatalogEditor\(card\)/);
  assert.match(app, /api\("catalog\/lookup\?game=pokemon&q=/);
  assert.match(app, /api\("cards\/" \+ encodeURIComponent\(card.id\) \+ "\/catalog"/);
  assert.match(app, /if \(!selectedId \|\| save.disabled\) return/);
  assert.match(app, /bindCatalogEditor\(one.card\)/);
  const versions = ['app.js', 'js/strings-v2.js', 'v2-theme.css'].map((f) => html.match(new RegExp(f.replaceAll('/', '\\/').replace('.', '\\.') + '\\?v=([^"&]+)'))?.[1]);
  assert.equal(new Set(versions).size, 1, 'cache-busting coerente');
});
