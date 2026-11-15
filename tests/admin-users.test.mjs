import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node before 22 */ }
const dbTest = (name, fn) => test(name, { skip: DatabaseSync ? false : 'Node 22+ sqlite' }, fn);
const api = DatabaseSync ? await import('../functions/api/[[path]].js') : null;
const iso = new Date().toISOString();
let counter = 0;
function insert(db, table, values) {
  const row = { ...values };
  for (const c of db.prepare(`PRAGMA table_info(${table})`).all()) {
    if (row[c.name] === undefined && c.notnull && c.dflt_value == null && !c.pk)
      row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : 'fixture' + ++counter;
  }
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k]));
}
function d1(db) {
  return { prepare(sql) {
    const st = db.prepare(sql); let values = [];
    const obj = { bind(...a) { values = a; return obj; },
      async first() { return st.get(...values) || null; },
      async all() { return { results: st.all(...values) }; },
      async run() { return { meta: { changes: Number(st.run(...values).changes) } }; } };
    return obj;
  } };
}
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const addUser = (id, name, opts = {}) => insert(db, 'users', {
    id, display_name: name, username: opts.noUsername ? null : id, email: id + '@example.test',
    created_at: iso, role: opts.role || 'user', album_public: opts.album_public ? 1 : 0, is_test: opts.is_test ? 1 : 0
  });
  for (const [id, name, role] of [['adm', 'Admin', 'admin'], ['zeta', 'Zeta', 'user'], ['alice', 'alice', 'user'], ['bruno', 'Bruno', 'user']]) {
    addUser(id, name, { role });
    insert(db, 'sessions', { token_hash: crypto.createHash('sha256').update('session-' + id).digest('hex'),
      user_id: id, expires_at: new Date(Date.now() + 3600000).toISOString() });
  }
  insert(db, 'card_models', { id: 'model', game: 'pokemon', set_name: 'Fossil', code_printed: '5/62', code_normalized: '5/62',
    name: 'Gengar', language: 'ENG', variant: 'normal', slug: 'gengar', created_at: iso });
  return { db, env: { DB: d1(db) }, addUser };
}
function card(db, id, owner, options = {}) {
  insert(db, 'slabs', {
    id, card_model_id: 'model', physical_owner_id: owner, digital_owner_id: options.digital_owner || owner,
    submitter_id: owner, grader: options.graded ? 'PSA' : 'NONE', certificate_no: 'CERT-' + id,
    is_ungraded: options.graded ? 0 : 1, status: options.status || 'approved',
    archived_at: options.archived ? iso : null, created_at: iso, server_seed: 'seed', client_nonce: 'nonce', commit_hash: 'hash'
  });
}
async function call(env, path, role = 'adm') {
  const headers = role ? { cookie: 'gemint_sid=session-' + role } : {};
  const response = await api.onRequest({ env, request: new Request('https://dreamint.it/api/' + path, { headers }) });
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
}

dbTest('directory: admin only, alphabetical and no private data for ordinary users or guests', async () => {
  const { env } = setup();
  assert.equal((await call(env, 'admin/users', null)).status, 401);
  assert.equal((await call(env, 'admin/users', 'alice')).status, 403);
  assert.equal((await call(env, 'admin/users/alice', 'zeta')).status, 403);
  const r = await call(env, 'admin/users');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.cache, 'no-store');
  assert.equal(r.body.total, 4);
  assert.deepEqual(r.body.users.map(u => u.id), ['adm', 'alice', 'bruno', 'zeta']);
  assert.equal(r.body.users.find(u => u.id === 'alice').album_public, 0);
  assert.equal(r.body.users.find(u => u.id === 'alice').email, 'alice@example.test');
  assert.equal((await call(env, 'admin/users/no-such-user')).status, 404);
});

dbTest('inventory lists album (including pending and private) and only active listings separately', async () => {
  const { env, db } = setup();
  card(db, 'graded', 'alice', { graded: true });
  card(db, 'raw', 'alice', { status: 'in_review' });
  card(db, 'archived', 'alice', { archived: true });
  card(db, 'sale', 'alice');
  card(db, 'digital', 'bruno', { graded: true, digital_owner: 'alice' });
  const listing = (id, slab, status) => insert(db, 'listings', {
    id, slab_id: slab, seller_id: 'alice', price_cents: 15800, status, created_at: iso
  });
  listing('active-one', 'sale', 'active');
  listing('closed-one', 'raw', 'closed');
  const r = await call(env, 'admin/users/alice');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.user.album_public, 0);
  assert.equal(r.body.cards_total, 4);
  assert.deepEqual(r.body.cards.map(x => x.id).sort(), ['digital', 'graded', 'raw', 'sale']);
  assert.equal(r.body.cards.find(x => x.id === 'raw').status, 'in_review');
  assert.equal(r.body.listings_total, 1);
  assert.deepEqual(r.body.listings.map(x => x.id), ['active-one']);
  assert.equal(r.body.listings[0].price_cents, 15800);
  const list = await call(env, 'admin/users');
  assert.equal(list.body.users.find(u => u.id === 'alice').cards_count, 4);
  assert.equal(list.body.users.find(u => u.id === 'alice').listings_count, 1);
});

dbTest('directory search treats % and _ literally; pagination stable even with empty pages', async () => {
  const { env, addUser } = setup();
  for (let i = 0; i < 84; i++) addUser('p' + String(i).padStart(3, '0'), 'User ' + String(i).padStart(3, '0'));
  addUser('under', 'x_y');
  const first = await call(env, 'admin/users?page=1');
  const second = await call(env, 'admin/users?page=2');
  const third = await call(env, 'admin/users?page=3');
  assert.equal(first.body.page_size, 40);
  assert.equal(first.body.pages, 3);
  assert.deepEqual([first.body.users.length, second.body.users.length, third.body.users.length], [40,40,9]);
  assert.ok(first.body.users.at(-1).display_name.localeCompare(second.body.users[0].display_name) < 0);
  assert.equal((await call(env, 'admin/users?page=9000')).body.page, 3);
  const literal = await call(env, 'admin/users?q=x_y');
  assert.deepEqual(literal.body.users.map(x => x.id), ['under']);
  assert.equal((await call(env, 'admin/users?q=%25')).body.total, 0);
});

dbTest('inventory pages 36 cards with consistent counts, inaccessible outside admin', async () => {
  const { env, db } = setup();
  for (let i=0; i<38; i++) card(db, 'c'+i, 'alice');
  const r = await call(env, 'admin/users/alice?album_page=2');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.album_page, 2);
  assert.equal(r.body.album_pages, 2);
  assert.equal(r.body.cards_total, 38);
  assert.equal(r.body.cards.length, 2);
  assert.equal((await call(env, 'admin/users/alice', null)).status, 401);
});

test('frontend includes admin directory navigation and protected UI routes', () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(app, /href="#\/admin\/utenti" data-link>Iscritti/);
  assert.match(app, /function pageAdminUsers\(/);
  assert.match(app, /function pageAdminUserDetail\(/);
  assert.match(app, /p\[0\] === "admin" && p\[1\] === "utenti"/);
  assert.match(html, /\/app\.js\?v=20261115v35adminusers/);
});
