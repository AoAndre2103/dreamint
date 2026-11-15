import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { notifyFollowersNewCard } from '../functions/lib/social.js';
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* old Node */ }
const dbTest = (name, fn) => test(name, { skip: DatabaseSync ? false : 'Node 22+ SQLite required' }, fn);
const api = DatabaseSync ? await import('../functions/api/[[path]].js') : null;
let seq = 0;
const iso = new Date().toISOString();
function insert(db, table, value) {
  const row = { ...value };
  for (const column of db.prepare(`PRAGMA table_info(${table})`).all()) {
    if (row[column.name] === undefined && column.notnull && column.dflt_value == null && !column.pk)
      row[column.name] = /INT|REAL/.test(column.type) ? 0 : 'fixture-' + (++seq);
  }
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
    .run(...columns.map(x => row[x]));
}
function d1(db) {
  return {
    prepare(sql) {
      const statement = db.prepare(sql); let bindings = [];
      const obj = { bind(...a) { bindings = a; return obj; },
        async first() { return statement.get(...bindings) || null; },
        async all() { return { results: statement.all(...bindings) }; },
        async run() { return { meta: { changes: Number(statement.run(...bindings).changes) } }; } };
      return obj;
    },
    async batch(commands) {
      db.exec('BEGIN');
      try { const results = []; for (const c of commands) results.push(await c.run()); db.exec('COMMIT'); return results; }
      catch (err) { db.exec('ROLLBACK'); throw err; }
    }
  };
}
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  for (const [id, role, isPublic] of [['seller', 'user', true], ['alice', 'user', true], ['bruno', 'user', true], ['admin', 'admin', true]]) {
    insert(db, 'users', { id, role, username:id, display_name:id, album_public:isPublic?1:0,
      is_test:0, email:`${id}@example.test`, created_at:iso });
    insert(db, 'sessions', { user_id:id, token_hash:crypto.createHash('sha256').update('token-'+id).digest('hex'),
      expires_at:new Date(Date.now()+3600000).toISOString() });
  }
  insert(db, 'card_models', { id:'model', game:'pokemon', set_name:'Fossil', code_printed:'5/62',
    code_normalized:'5/62', name:'Gengar', language:'ENG', variant:'normal', slug:'gengar', created_at:iso });
  const env = { DB:d1(db), PHOTOS:{ async list(){ return {keys:[{name:'photo:card:back'}]}; } } };
  return { db, env };
}
function card(db, id, owner='seller', extra={}) {
  insert(db, 'slabs', { id, card_model_id:'model', submitter_id:owner, physical_owner_id:owner, digital_owner_id:owner,
    grader:'NONE', certificate_no:'RAW-'+id, is_ungraded:1, status:'in_review',
    created_at:iso, server_seed:'seed', commit_hash:'hash', client_nonce:'nonce', ...extra });
}
async function call(env, path, user=null, method='GET', body=null) {
  const headers = { ...(user ? {cookie:'gemint_sid=token-'+user} : {}) };
  if (method !== 'GET') headers.origin = 'https://dreamint.it';
  const request = new Request('https://dreamint.it/api/'+path, {
    method, headers, ...(body ? {body:JSON.stringify(body)} : {})
  });
  const response = await api.onRequest({ env, request });
  return {status:response.status, body:await response.json(), cache:response.headers.get('cache-control')};
}

dbTest('seguire: login obbligatorio, self-follow vietato, ricerca sicura e idempotenza', async () => {
  const {db, env} = setup();
  assert.equal((await call(env, 'users/seller/follow', null, 'POST')).status, 401);
  assert.equal((await call(env, 'users/seller/follow', 'seller', 'POST')).status, 400);
  assert.equal((await call(env, 'users/%25/follow', 'alice')).status, 404);
  assert.equal((await call(env, 'users/seller/follow', 'alice', 'POST')).status, 200);
  assert.equal((await call(env, 'users/SELLER/follow', 'alice', 'POST')).status, 200);
  const status = await call(env, 'users/seller/follow', 'alice');
  assert.equal(status.body.following, true);
  assert.equal(status.body.followers_count, 1);
  assert.equal(status.cache, 'no-store');
  assert.equal((await call(env, 'users/seller/follow', 'bruno')).body.following, false);
  assert.equal((await call(env, 'me/following', 'alice')).body.users[0].username, 'seller');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_follows').get().n, 1);
});

dbTest('notifiche al momento della pubblicazione, non durante la verifica; mai duplicate', async () => {
  const {db, env} = setup();
  await call(env, 'users/seller/follow', 'alice', 'POST');
  await call(env, 'users/seller/follow', 'bruno', 'POST');
  card(db, 'one');
  assert.equal(await notifyFollowersNewCard(env, 'one'), 0);
  assert.equal((await call(env, 'me/notifications', 'alice')).body.unread_count, 0);
  db.prepare("UPDATE slabs SET status = 'approved' WHERE id = 'one'").run();
  assert.equal(await notifyFollowersNewCard(env, 'one'), 2);
  assert.equal(await notifyFollowersNewCard(env, 'one'), 0);
  const notice = await call(env, 'me/notifications', 'alice');
  assert.equal(notice.body.unread_count, 1);
  assert.equal(notice.body.notifications[0].card_name, 'Gengar');
  assert.equal(notice.body.notifications[0].actor_username, 'seller');
  assert.equal(notice.body.notifications[0].card_id, 'one');
  assert.equal((await call(env, 'me/notifications', 'seller')).body.unread_count, 0);
  assert.equal((await call(env, 'me/notifications', null)).status, 401);
  assert.equal((await call(env, 'me/notifications/read', null, 'POST')).status, 401);
  assert.equal((await call(env, 'me/notifications/read', 'alice', 'POST')).status, 200);
  assert.equal((await call(env, 'me/notifications', 'alice')).body.unread_count, 0);
  assert.equal((await call(env, 'me/notifications', 'bruno')).body.unread_count, 1);
});

dbTest('album privato, carte test, archiviate o cedute non producono/notificano informazioni', async () => {
  const {db, env} = setup();
  await call(env, 'users/seller/follow', 'alice', 'POST');
  card(db, 'private', 'seller', {status:'approved'});
  db.prepare("UPDATE users SET album_public = 0 WHERE id = 'seller'").run();
  assert.equal(await notifyFollowersNewCard(env, 'private'), 0);
  db.prepare("UPDATE users SET album_public = 1 WHERE id = 'seller'").run();
  card(db, 'test-card', 'seller', {status:'approved', is_test:1});
  card(db, 'archived', 'seller', {status:'approved', archived_at:iso});
  assert.equal(await notifyFollowersNewCard(env, 'test-card'), 0);
  assert.equal(await notifyFollowersNewCard(env, 'archived'), 0);
  assert.equal(await notifyFollowersNewCard(env, 'private'), 1);
  db.prepare("UPDATE users SET album_public = 0 WHERE id = 'seller'").run();
  assert.equal((await call(env, 'me/notifications', 'alice')).body.unread_count, 0);
  assert.equal((await call(env, 'me/notifications', 'alice')).body.notifications.length, 0);
  db.prepare("UPDATE users SET album_public = 1 WHERE id = 'seller'").run();
  db.prepare("UPDATE slabs SET physical_owner_id = 'bruno' WHERE id = 'private'").run();
  assert.equal((await call(env, 'me/notifications', 'alice')).body.unread_count, 0);
});

dbTest('non seguire: cancellazione notifiche del profilo ma non quelle di altri account', async () => {
  const {db, env} = setup();
  await call(env, 'users/seller/follow', 'alice', 'POST');
  await call(env, 'users/bruno/follow', 'alice', 'POST');
  card(db, 'first', 'seller', {status:'approved'});
  card(db, 'second', 'bruno', {status:'approved'});
  await notifyFollowersNewCard(env, 'first');
  await notifyFollowersNewCard(env, 'second');
  assert.equal((await call(env, 'me/notifications', 'alice')).body.unread_count, 2);
  assert.equal((await call(env, 'users/seller/follow', 'alice', 'DELETE')).body.following, false);
  const remaining = await call(env, 'me/notifications', 'alice');
  assert.equal(remaining.body.unread_count, 1);
  assert.equal(remaining.body.notifications[0].actor_username, 'bruno');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM follow_notifications').get().n, 1);
});

dbTest('approvazione admin reale: la pubblicazione scatena la notifica una volta sola', async () => {
  const {db, env} = setup();
  await call(env, 'users/seller/follow', 'alice', 'POST');
  card(db, 'new-raw', 'seller');
  const response = await call(env, 'admin/cards/new-raw/approve', 'admin', 'POST', {});
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal((await call(env, 'me/notifications', 'alice')).body.unread_count, 1);
  assert.equal((await call(env, 'admin/cards/new-raw/approve', 'admin', 'POST', {})).status, 400);
  assert.equal((await call(env, 'me/notifications', 'alice')).body.notifications.length, 1);
});

test('frontend: pulsante Segui, inbox, badge, migrazione e script versionato', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const deploy = fs.readFileSync(new URL('../DEPLOY.sh', import.meta.url), 'utf8');
  assert.match(app, /data-follow-action/);
  assert.match(app, /function bindFollowProfile\(/);
  assert.match(app, /if \(p\[0\] === 'notifiche'\)/);
  assert.match(app, /function pageFollowNotifications\(/);
  assert.match(app, /function refreshNotificationCount\(/);
  assert.match(html, /app\.js\?v=20261115v36follows/);
  assert.match(deploy, /migrate-v36\.sql/);
});
