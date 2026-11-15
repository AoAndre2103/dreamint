// v33: exercise the graded certificate path against the real API and SQLite schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22 */ }
const dbTest = (name, fn) => test(name, { skip: !DatabaseSync }, fn);
const api = DatabaseSync ? await import('../functions/api/[[path]].js') : null;
const iso = (t = Date.now()) => new Date(t).toISOString();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function d1(db) {
  return {
    prepare(sql) {
      const st = db.prepare(sql); let args = [];
      const o = {
        bind(...a) { args = a; return o; },
        async first() { return st.get(...args) || null; },
        async all() { return { results: st.all(...args) }; },
        async run() { return { meta: { changes: Number(st.run(...args).changes) } }; }
      };
      return o;
    },
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = []; for (const st of stmts) out.push(await st.run());
        db.exec('COMMIT'); return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
  };
}
let serial = 0;
function insert(db, table, values) {
  const row = { ...values };
  for (const c of db.prepare(`PRAGMA table_info(${table})`).all()) {
    if (row[c.name] === undefined && c.notnull && c.dflt_value == null && !c.pk)
      row[c.name] = /INT|NUM|REAL/.test(c.type) ? 0 : 'fixture' + (++serial);
  }
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => row[k]));
}
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  for (const id of ['seller','buyer','stranger','admin']) {
    insert(db, 'users', { id, username: id + '_gr', display_name: id, email: `${id}@example.test`,
      role: id === 'admin' ? 'admin' : 'user', email_verified_at: iso(), created_at: iso() });
    insert(db, 'sessions', { user_id: id, token_hash: sha('token-'+id), expires_at: iso(Date.now()+3600000) });
  }
  insert(db,'card_models',{ id:'model',game:'pokemon',set_name:'Fossil',code_printed:'5/62',
    code_normalized:'5/62',name:'Gengar',language:'ITA',variant:'normal',slug:'gengar-graded',created_at:iso()});
  insert(db,'slabs',{id:'graded',card_model_id:'model',submitter_id:'seller',physical_owner_id:'seller',
    digital_owner_id:'seller',grader:'PSA',certificate_no:'PSA123',grade:'9',is_ungraded:0,
    status:'approved',rarity_tier:'comune',serial_number:10,assigned_at:iso(),opened_at:iso(),
    server_seed:'seed',commit_hash:'hash',client_nonce:'nonce',created_at:iso(),asking_price_cents:9000});
  insert(db,'slabs',{id:'raw',card_model_id:'model',submitter_id:'seller',physical_owner_id:'seller',
    digital_owner_id:'seller',grader:'NONE',certificate_no:'RAW123',is_ungraded:1,status:'approved',
    server_seed:'seed',commit_hash:'hash',client_nonce:'nonce',created_at:iso()});
  return { db, env: { DB:d1(db), PHOTOS:{ async get(){return null;}} } };
}
async function req(env, method, path, who='seller', data) {
  const headers = {'content-type':'application/json'};
  if (who) headers.cookie='gemint_sid=token-'+who;
  const r=await api.onRequest({env,request:new Request('https://dreamint.test/api/'+path,{
    method,headers,...(data && method !== 'GET' ? {body:JSON.stringify(data)}:{})
  })});
  return {status:r.status, body:await r.json()};
}
const redeem = (env, who, code) => req(env,'POST','copies/redeem',who,{ certificate_no:'PSA123',grader:'PSA',transfer_code:code });

dbTest('gradata: il certificato genera un codice, lo rivela solo al proprietario e la rigenerazione invalida il precedente', async () => {
  const {db, env} = setup();
  const first=await req(env,'GET','cards/graded/certificate');
  assert.equal(first.status,200,JSON.stringify(first.body));
  const one=first.body.certificate.transfer_code;
  assert.match(one,/^DM-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const repeat=await req(env,'GET','cards/graded/certificate');
  assert.equal(repeat.body.certificate.transfer_code,one);
  assert.equal((await req(env,'POST','cards/graded/transfer-code','stranger',{})).status,403);
  assert.equal((await req(env,'POST','cards/graded/transfer-code','admin',{})).status,403);
  assert.equal((await req(env,'POST','cards/raw/transfer-code','seller',{})).status,404);
  const generated=await req(env,'POST','cards/graded/transfer-code','seller',{});
  assert.equal(generated.status,200,JSON.stringify(generated.body));
  assert.notEqual(generated.body.transfer_code,one);
  assert.equal((await redeem(env,'buyer',one)).status,400);
  assert.equal(db.prepare("SELECT user_id FROM transfer_code_reveals WHERE slab_id='graded'").get().user_id,'seller');
});

dbTest('gradata: trasferimento completo una sola volta, preserva rarità e seriale, ruota il codice', async () => {
  const {db, env} = setup();
  const code=(await req(env,'POST','cards/graded/transfer-code','seller',{})).body.transfer_code;
  const done=await redeem(env,'buyer',code);
  assert.equal(done.status,200,JSON.stringify(done.body));
  const slab=db.prepare('SELECT physical_owner_id,digital_owner_id,rarity_tier,serial_number,asking_price_cents FROM slabs WHERE id=?').get('graded');
  assert.equal(slab.physical_owner_id,'buyer');
  assert.equal(slab.digital_owner_id,'buyer');
  assert.equal(slab.rarity_tier,'comune'); assert.equal(slab.serial_number,10);
  assert.equal(slab.asking_price_cents,null);
  assert.equal((await redeem(env,'stranger',code)).status,400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM slab_owner_history WHERE slab_id=?').get('graded').n,1);
  assert.equal(db.prepare("SELECT user_id FROM transfer_code_reveals WHERE slab_id='graded'").get().user_id,'buyer');
  assert.equal((await req(env,'GET','cards/graded/certificate','seller')).status,401);
  const buyer=(await req(env,'GET','cards/graded/certificate','buyer')).body.certificate;
  assert.equal(buyer.transfer_code,done.body.transfer_code);
  assert.ok(buyer.transfer_code !== code);
  assert.equal((await req(env,'POST','cards/graded/transfer-code','seller',{})).status,403);
  assert.equal((await redeem(env,'stranger',buyer.transfer_code)).status,200);
  assert.equal(db.prepare("SELECT physical_owner_id FROM slabs WHERE id='graded'").get().physical_owner_id,'stranger');
});

dbTest('gradata: annuncio attivo resta online fino al riscatto, poi chiude; richieste e ordini bloccano', async () => {
  const {db,env}=setup();
  insert(db,'listings',{id:'list',slab_id:'graded',seller_id:'seller',price_cents:9999,status:'active',created_at:iso()});
  insert(db,'price_offers',{id:'offer',listing_id:'list',slab_id:'graded',seller_id:'seller',buyer_id:'stranger',offer_cents:6000,status:'accepted',created_at:iso(),updated_at:iso()});
  const made=await req(env,'POST','cards/graded/transfer-code','seller',{});
  assert.equal(made.status,200,JSON.stringify(made.body));
  assert.equal(db.prepare("SELECT status FROM listings WHERE id='list'").get().status,'active');
  assert.equal(db.prepare("SELECT status FROM price_offers WHERE id='offer'").get().status,'accepted');
  const code=made.body.transfer_code;
  const done=await redeem(env,'buyer',code);
  assert.equal(done.status,200,JSON.stringify(done.body));
  assert.equal(db.prepare("SELECT status FROM listings WHERE id='list'").get().status,'closed');
  assert.equal(db.prepare("SELECT status FROM price_offers WHERE id='offer'").get().status,'cancelled');
  assert.equal(db.prepare("SELECT physical_owner_id FROM slabs WHERE id='graded'").get().physical_owner_id,'buyer');
  assert.equal((await redeem(env,'stranger',code)).status,400);
});

dbTest('gradata: trasferimento bloccato durante vendita o richiesta di acquisto attiva', async () => {
  const {db,env}=setup();
  const code=(await req(env,'POST','cards/graded/transfer-code','seller',{})).body.transfer_code;
  insert(db,'listings',{id:'list',slab_id:'graded',seller_id:'seller',price_cents:9999,status:'active',created_at:iso()});
  insert(db,'sales',{id:'s',slab_id:'graded',listing_id:'list',seller_id:'seller',buyer_id:'stranger',status:'requested',created_at:iso()});
  assert.equal((await req(env,'POST','cards/graded/transfer-code','seller',{})).status,409);
  assert.equal((await redeem(env,'buyer',code)).status,409);
  assert.equal(db.prepare("SELECT status FROM listings WHERE id='list'").get().status,'active');
  db.prepare("UPDATE sales SET status='paid' WHERE id='s'").run();
  assert.equal((await redeem(env,'buyer',code)).status,409);
  db.prepare("UPDATE sales SET status='cancelled' WHERE id='s'").run();
  assert.equal((await redeem(env,'buyer',code)).status,200);
  assert.equal(db.prepare("SELECT status FROM listings WHERE id='list'").get().status,'closed');
});

dbTest('gradata: due riscatti contemporanei dello stesso codice non trasferiscono due volte', async () => {
  const {db,env}=setup();
  const code=(await req(env,'POST','cards/graded/transfer-code','seller',{})).body.transfer_code;
  const results=await Promise.all([redeem(env,'buyer',code),redeem(env,'stranger',code)]);
  assert.equal(results.filter(x=>x.status===200).length,1,JSON.stringify(results));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM slab_owner_history WHERE slab_id='graded'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM transfer_code_reveals WHERE slab_id='graded'").get().n,1);
});

test('interfaccia: un solo percorso per non gradate, codice gradate nel certificato (nessun pulsante 15 minuti)', () => {
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const cert=fs.readFileSync(new URL('../public/js/certificate.js',import.meta.url),'utf8');
  assert.match(app,/function soldOutsideHtml\(c\)/);
  assert.match(app,/if \(!c \|\| !c\.is_ungraded/);
  assert.match(app, /#\/trasferimento-non-gradata/);
  assert.match(cert,/if \(!c \|\| c\.is_ungraded/);
  assert.doesNotMatch(app + cert, /Genera codice monouso \(15 minuti\)|Trasferisci la carta fuori da DreaMint/);
});

dbTest('gradata: il riscatto con foto approvato dall’admin trasferisce la carta e genera un nuovo codice', async () => {
  const { db, env } = setup();
  insert(db,'digital_claims',{id:'claim',slab_id:'graded',claimant_id:'buyer',grader:'PSA',
    certificate_no:'PSA123',status:'pending',created_at:iso(Date.now()-9*86400000),
    dispute_until:iso(Date.now()-86400000),photo_count:1});
  const result=await req(env,'POST','admin/claims/claim/approve','admin',{});
  assert.equal(result.status,200,JSON.stringify(result.body));
  const row=db.prepare("SELECT status,reviewed_by FROM digital_claims WHERE id='claim'").get();
  assert.equal(row.status,'approved'); assert.equal(row.reviewed_by,'admin');
  assert.equal(db.prepare("SELECT physical_owner_id FROM slabs WHERE id='graded'").get().physical_owner_id,'buyer');
  assert.match((await req(env,'GET','cards/graded/certificate','buyer')).body.certificate.transfer_code,/^DM-/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM slab_owner_history WHERE slab_id='graded'").get().n,1);
});

dbTest('gradata: il certificato permette un codice con annuncio attivo e blocca solo la vendita', async () => {
  const {db,env}=setup();
  insert(db,'listings',{id:'live',slab_id:'graded',seller_id:'seller',price_cents:9999,status:'active',created_at:iso()});
  const shown=(await req(env,'GET','cards/graded/certificate','seller')).body.certificate;
  assert.equal(shown.transfer_locked,false);
  assert.equal(shown.can_regenerate,true);
  assert.equal((await req(env,'POST','cards/graded/transfer-code','seller',{})).status,200);
  assert.equal(db.prepare("SELECT status FROM listings WHERE id='live'").get().status,'active');
  insert(db,'sales',{id:'paid',slab_id:'graded',listing_id:'live',seller_id:'seller',buyer_id:'stranger',status:'paid',created_at:iso()});
  const blocked=(await req(env,'GET','cards/graded/certificate','seller')).body.certificate;
  assert.equal(blocked.transfer_locked,true);
  assert.equal(blocked.can_regenerate,false);
  assert.equal((await req(env,'POST','cards/graded/transfer-code','seller',{})).status,409);
});

test('i file aggiornati del trasferimento hanno URL versionati per evitare codice vecchio in cache', () => {
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const cert=fs.readFileSync(new URL('../public/js/certificate.js',import.meta.url),'utf8');
  assert.match(html,/\/js\/certificate\.js\?v=20261115v34redeem/);
  assert.match(html,/\/app\.js\?v=20261115v37bell/);
  assert.match(html,/\/js\/i18n\.js\?v=20261115v34redeem/);
  assert.match(cert,/can_regenerate/);
  assert.match(cert,/transfer_locked/);
});
