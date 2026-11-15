import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRawTransferCode, normalizeRawTransferCode } from '../functions/lib/ungraded-transfer.js';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* node older than 22 */ }
const dbTest = (name, fn) => test(name, { skip: DatabaseSync ? false : 'needs node:sqlite' }, fn);
const api = DatabaseSync ? await import('../functions/api/[[path]].js') : null;
const iso = (t) => new Date(t).toISOString();

function d1(db) {
  return {
    prepare(sql) {
      const st = db.prepare(sql);
      let args = [];
      const p = { bind(...a) { args = a; return p; },
        async first() { return st.get(...args) || null; },
        async all() { return { results: st.all(...args) }; },
        async run() { return { meta: { changes: Number(st.run(...args).changes) } }; }
      }; return p;
    },
    async batch(stmts) {
      db.exec('BEGIN'); try {
        const out = []; for (const stmt of stmts) out.push(await stmt.run()); db.exec('COMMIT'); return out;
      } catch (err) { db.exec('ROLLBACK'); throw err; }
    }
  };
}
let nextId = 0;
function insert(db, table, values) {
  const row = { ...values };
  for (const c of db.prepare(`PRAGMA table_info(${table})`).all()) {
    if (row[c.name] === undefined && c.notnull && c.dflt_value == null && !c.pk)
      row[c.name] = /INT|NUM|REAL/.test(c.type) ? 0 : 'fixture' + (++nextId);
  }
  const fields = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`)
    .run(...fields.map((x) => row[x]));
}
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  for (const id of ['seller', 'buyer', 'stranger']) {
    insert(db, 'users', { id, display_name: id, username: 'raw_' + id,
      email: `${id}@example.test`, email_verified_at: iso(Date.now() - 60000), created_at: iso(Date.now()) });
    insert(db, 'sessions', { user_id: id, token_hash: crypto.createHash('sha256').update('token-' + id).digest('hex'),
      expires_at: iso(Date.now() + 3600000) });
  }
  insert(db, 'card_models', { id: 'gengar-model', game: 'pokemon', set_name: 'Fossil', code_printed: '5/62',
    code_normalized: '5/62', name: 'Gengar', language: 'ITA', variant: 'normal', slug: 'gengar-fossil', created_at: iso(Date.now()) });
  const env = { DB: d1(db), PHOTOS: { async list() { return { keys: [ { name: 'photo:gengar:front' }, { name: 'photo:gengar:back' } ] }; } } };
  return { db, env };
}
function addCard(db, id = 'gengar', opts = {}) {
  insert(db, 'slabs', { id, card_model_id: 'gengar-model', submitter_id: 'seller', physical_owner_id: 'seller',
    digital_owner_id: 'seller', grader: opts.graded ? 'PSA' : 'NONE', certificate_no: 'R-' + id,
    is_ungraded: opts.graded ? 0 : 1, status: opts.status || 'approved',
    server_seed: 'seed', commit_hash: 'hash', client_nonce: 'nonce', created_at: iso(Date.now()),
    archived_at: opts.archived ? iso(Date.now() - 86400000) : null,
    archived_reason: opts.archived ? (opts.archiveReason || 'sold_outside') : null, asking_price_cents: 15000 });
}
async function call(env, method, path, who='seller', data, origin) {
  const headers = { 'content-type': 'application/json' };
  if (who) headers.cookie = 'gemint_sid=token-' + who;
  if (origin) headers.origin = origin;
  const r = await api.onRequest({ env, request: new Request('https://dreamint.test/api/' + path, {
    method, headers, ...((data && method !== 'GET') ? { body: JSON.stringify(data) } : {})
  }) });
  return { status: r.status, body: await r.json() };
}

test('strong monouse ungraded code with distinct prefix from graded certificates', () => {
  const seen = new Set();
  for (let i=0;i<30;i++) {
    const c = createRawTransferCode();
    assert.match(c, /^DMU-(?:[A-HJ-NP-Z2-9]{5}-){3}[A-HJ-NP-Z2-9]{5}$/);
    assert.equal(normalizeRawTransferCode(c).length, 23);
    seen.add(c);
  }
  assert.equal(seen.size, 30);
});

dbTest('vendita esterna: generazione, riscatto e passaggio effettivo nell’album del compratore', async () => {
  const {db, env} = setup(); addCard(db);
  const eligible = await call(env, 'GET', 'ungraded-transfers/eligible');
  assert.equal(eligible.status, 200);
  assert.equal(eligible.body.cards.length, 1);
  const created = await call(env, 'POST', 'cards/gengar/ungraded-transfer-code', 'seller', {});
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.ok(created.body.code);
  assert.equal(db.prepare('SELECT length(code_hash) n FROM ungraded_transfer_codes').get().n, 64);
  assert.equal((await call(env, 'POST', 'ungraded-transfers/redeem', 'buyer', { code: 'bad' })).status, 400);
  const redeemed = await call(env, 'POST', 'ungraded-transfers/redeem', 'buyer', {code: created.body.code.toLowerCase()});
  assert.equal(redeemed.status, 200, JSON.stringify(redeemed.body));
  const state = db.prepare('SELECT physical_owner_id, digital_owner_id, archived_at, status, asking_price_cents FROM slabs WHERE id = ?').get('gengar');
  assert.equal(state.physical_owner_id, 'buyer');
  assert.equal(state.digital_owner_id, 'buyer');
  assert.equal(state.status, 'approved');
  assert.equal(state.asking_price_cents, null);
  assert.equal(db.prepare('SELECT count(*) n FROM ungraded_transfer_codes').get().n, 0);
  assert.equal((await call(env, 'GET', 'cards', 'seller')).body.cards.some((x)=>x.id==='gengar'), false);
  assert.equal((await call(env, 'GET', 'cards', 'buyer')).body.cards.some((x)=>x.id==='gengar'), true);
  assert.equal(db.prepare("SELECT count(*) n FROM slab_owner_history WHERE reason='raw_transfer_code' AND from_user_id='seller' AND to_user_id='buyer'").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM audit_logs WHERE action='raw_transfer_redeemed'").get().n, 1);
  assert.equal((await call(env, 'POST', 'ungraded-transfers/redeem', 'stranger', {code: created.body.code})).status, 400);
  assert.equal((await call(env, 'POST', 'cards/gengar/ungraded-transfer-code', 'seller', {})).status, 404);
  assert.equal((await call(env, 'GET', 'cards/gengar', 'buyer')).body.card.photos.front, true);
});

dbTest('due riscatti concorrenti di non gradata con annuncio aperto chiudono una sola volta', async () => {
  const {db,env} = setup(); addCard(db);
  insert(db,'listings',{id:'concurrent',slab_id:'gengar',seller_id:'seller',price_cents:15000,status:'active',created_at:iso(Date.now())});
  const created=await call(env,'POST','cards/gengar/ungraded-transfer-code','seller',{});
  assert.equal(created.status,200);
  const outcomes=await Promise.all([
    call(env,'POST','ungraded-transfers/redeem','buyer',{code:created.body.code}),
    call(env,'POST','ungraded-transfers/redeem','stranger',{code:created.body.code})
  ]);
  assert.equal(outcomes.filter(x=>x.status===200).length,1,JSON.stringify(outcomes));
  assert.equal(db.prepare("SELECT status FROM listings WHERE id='concurrent'").get().status,'closed');
  assert.equal(db.prepare("SELECT count(*) n FROM slab_owner_history WHERE slab_id='gengar'").get().n,1);
  assert.ok(['buyer','stranger'].includes(db.prepare("SELECT physical_owner_id FROM slabs WHERE id='gengar'").get().physical_owner_id));
});

dbTest('rigenerare il codice invalida quello precedente', async () => {
  const {db,env} = setup(); addCard(db);
  const one = await call(env, 'POST', 'cards/gengar/ungraded-transfer-code', 'seller', {});
  const two = await call(env, 'POST', 'cards/gengar/ungraded-transfer-code', 'seller', {});
  assert.notEqual(one.body.code, two.body.code);
  assert.equal((await call(env, 'POST', 'ungraded-transfers/redeem', 'buyer', {code:one.body.code})).status, 400);
  assert.equal((await call(env, 'POST', 'ungraded-transfers/redeem', 'buyer', {code:two.body.code})).status, 200);
});

dbTest('sicurezza: autenticazione, CSRF, verifica email, proprietario, gradate e codice del venditore', async () => {
  const {db,env} = setup(); addCard(db); addCard(db,'graded', {graded:true});
  assert.equal((await call(env, 'POST', 'cards/gengar/ungraded-transfer-code', null, {})).status, 401);
  assert.equal((await call(env, 'POST', 'cards/gengar/ungraded-transfer-code', 'stranger', {})).status, 404);
  assert.equal((await call(env, 'POST', 'cards/gengar/ungraded-transfer-code', 'seller', {}, 'https://evil.test')).status, 403);
  assert.equal((await call(env, 'POST', 'cards/graded/ungraded-transfer-code', 'seller', {})).status, 400);
  db.prepare('UPDATE users SET email_verified_at = NULL WHERE id = ?').run('buyer');
  assert.equal((await call(env, 'POST', 'ungraded-transfers/redeem', 'buyer', {code:'DMU-AAAAA-AAAAA-AAAAA-AAAAA'})).status, 403);
  db.prepare('UPDATE users SET email_verified_at = NULL WHERE id = ?').run('seller');
  assert.equal((await call(env, 'POST', 'cards/gengar/ungraded-transfer-code', 'seller', {})).status, 403);
  db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').run(iso(Date.now()),'seller');
  const made = await call(env, 'POST', 'cards/gengar/ungraded-transfer-code', 'seller', {});
  assert.equal((await call(env, 'POST', 'ungraded-transfers/redeem', 'seller', {code:made.body.code})).status, 409);
});

dbTest('non gradata: annuncio resta in vendita fino al riscatto; si chiude nello stesso batch', async () => {
  const {db,env} = setup(); addCard(db);
  insert(db,'listings',{id:'listing',slab_id:'gengar',seller_id:'seller',price_cents:15000,status:'active',created_at:iso(Date.now())});
  insert(db,'price_offers',{id:'offer',listing_id:'listing',slab_id:'gengar',seller_id:'seller',buyer_id:'stranger',offer_cents:12500,status:'pending',created_at:iso(Date.now()),updated_at:iso(Date.now())});
  const code=(await call(env,'POST','cards/gengar/ungraded-transfer-code','seller',{}));
  assert.equal(code.status,200,JSON.stringify(code.body));
  assert.equal(db.prepare("SELECT status FROM listings WHERE id='listing'").get().status,'active');
  assert.equal(db.prepare("SELECT status FROM price_offers WHERE id='offer'").get().status,'pending');
  assert.equal((await call(env,'POST','ungraded-transfers/redeem','buyer',{code:'DMU-AAAAA-AAAAA-AAAAA-AAAAA'})).status,400);
  assert.equal(db.prepare("SELECT status FROM listings WHERE id='listing'").get().status,'active');
  const done=await call(env,'POST','ungraded-transfers/redeem','buyer',{code:code.body.code});
  assert.equal(done.status,200,JSON.stringify(done.body));
  assert.equal(done.body.listing_closed,1);
  assert.equal(db.prepare("SELECT status FROM listings WHERE id='listing'").get().status,'closed');
  assert.equal(db.prepare("SELECT status FROM price_offers WHERE id='offer'").get().status,'cancelled');
  assert.equal(db.prepare("SELECT physical_owner_id FROM slabs WHERE id='gengar'").get().physical_owner_id,'buyer');
  assert.equal((await call(env,'POST','ungraded-transfers/redeem','stranger',{code:code.body.code})).status,400);
  assert.equal(db.prepare("SELECT count(*) n FROM slab_owner_history WHERE slab_id='gengar'").get().n,1);
});

dbTest('non gradata: richiesta di acquisto o pagamento attivo bloccano generazione e riscatto senza chiudere annuncio', async () => {
  const {db,env} = setup(); addCard(db);
  insert(db,'listings',{id:'listing',slab_id:'gengar',seller_id:'seller',price_cents:15000,status:'active',created_at:iso(Date.now())});
  const code=(await call(env,'POST','cards/gengar/ungraded-transfer-code','seller',{})).body.code;
  insert(db,'sales',{id:'sale',listing_id:'listing',slab_id:'gengar',seller_id:'seller',buyer_id:'stranger',price_cents:15000,status:'requested',created_at:iso(Date.now())});
  assert.equal((await call(env,'POST','cards/gengar/ungraded-transfer-code','seller',{})).status,409);
  assert.equal((await call(env,'POST','ungraded-transfers/redeem','buyer',{code})).status,409);
  assert.equal(db.prepare("SELECT status FROM listings WHERE id='listing'").get().status,'active');
  assert.equal(db.prepare("SELECT physical_owner_id FROM slabs WHERE id='gengar'").get().physical_owner_id,'seller');
  db.prepare("UPDATE sales SET status='paid' WHERE id='sale'").run();
  assert.equal((await call(env,'POST','ungraded-transfers/redeem','buyer',{code})).status,409);
  db.prepare("UPDATE sales SET status='cancelled' WHERE id='sale'").run();
  assert.equal((await call(env,'POST','ungraded-transfers/redeem','buyer',{code})).status,200);
  assert.equal(db.prepare("SELECT status FROM listings WHERE id='listing'").get().status,'closed');
});

dbTest('non gradata già archiviata come venduta fuori può passare al compratore', async () => {
  const {db,env}=setup();addCard(db,'archived',{archived:true});addCard(db,'removed',{archived:true,archiveReason:'owner_removed'});
  const eligible = await call(env,'GET','ungraded-transfers/eligible','seller');
  assert.deepEqual(eligible.body.cards.map(x=>x.id),['archived']);
  assert.equal((await call(env,'POST','cards/removed/ungraded-transfer-code','seller',{})).status,409);
  const c=(await call(env,'POST','cards/archived/ungraded-transfer-code','seller',{})).body.code;
  const r=await call(env,'POST','ungraded-transfers/redeem','buyer',{code:c});
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(db.prepare("SELECT archived_at FROM slabs WHERE id='archived'").get().archived_at,null);
  assert.ok((await call(env,'GET','cards','buyer')).body.cards.some(x=>x.id==='archived'));
});

dbTest('codice scaduto non trasferisce la proprietà', async () => {
  const {db,env}=setup();addCard(db);
  const c=(await call(env,'POST','cards/gengar/ungraded-transfer-code','seller',{})).body.code;
  db.prepare('UPDATE ungraded_transfer_codes SET expires_at = ?').run(iso(Date.now()-10000));
  assert.equal((await call(env,'POST','ungraded-transfers/redeem','buyer',{code:c})).status,400);
  assert.equal(db.prepare("SELECT physical_owner_id FROM slabs WHERE id='gengar'").get().physical_owner_id,'seller');
});

test('UI: accessibile dall’album e dalla scheda non gradata, con generazione e riscatto', () => {
  const ui=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const lang=fs.readFileSync(new URL('../public/js/i18n.js',import.meta.url),'utf8');
  const deploy=fs.readFileSync(new URL('../DEPLOY.sh',import.meta.url),'utf8');
  assert.match(ui, /pageRawTransfer\(/);
  assert.match(ui, /#\/trasferimento-non-gradata/);
  assert.match(ui, /ungraded-transfers\/redeem/);
  assert.match(ui, /ungraded-transfer-code/);
  assert.match(deploy,/migrate-v32\.sql/);
  for (const key of ['rawTransfer.title','rawTransfer.redeem','rawTransfer.generate','rawTransfer.success'])
    assert.equal((lang.match(new RegExp('"'+key.replace('.','\\.')+'":','g'))||[]).length,2,key);
});

dbTest('caso reale: vendo fuori, genero il codice e l’annuncio si chiude soltanto quando l’acquirente lo usa', async () => {
  const { db, env } = setup(); addCard(db);
  insert(db, 'listings', { id: 'sale-outside-listing', slab_id: 'gengar', seller_id: 'seller',
    price_cents: 12000, status: 'active', created_at: iso(Date.now()) });
  const eligible = await call(env, 'GET', 'ungraded-transfers/eligible', 'seller');
  assert.equal(eligible.status,200);
  assert.equal(eligible.body.cards[0].listing_open,true);
  const created = await call(env, 'POST', 'cards/gengar/ungraded-transfer-code', 'seller', {});
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(db.prepare("SELECT status FROM listings WHERE id='sale-outside-listing'").get().status,'active');
  const done = await call(env, 'POST', 'ungraded-transfers/redeem', 'buyer', {code:created.body.code});
  assert.equal(done.status,200,JSON.stringify(done.body));
  assert.equal(db.prepare("SELECT status FROM listings WHERE id='sale-outside-listing'").get().status,'closed');
  assert.equal(db.prepare("SELECT physical_owner_id, archived_at FROM slabs WHERE id='gengar'").get().physical_owner_id,'buyer');
  assert.equal(db.prepare("SELECT archived_at FROM slabs WHERE id='gengar'").get().archived_at,null);
  assert.equal((await call(env,'POST','ungraded-transfers/redeem','stranger',{code:created.body.code})).status,400);
});
