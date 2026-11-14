// v27c: il venditore elimina il proprio annuncio scegliendo un motivo (POST /api/listings/:id/close).
// Gira sull'API vera (onRequest) con SQLite in memoria e schema.sql. Serve Node 22 (node:sqlite): altrimenti si salta.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) { DatabaseSync = null; }
const dbTest = (name, fn) => test(name, { skip: DatabaseSync ? false : "node:sqlite non disponibile (serve Node 22+)" }, fn);

const api = DatabaseSync ? await import(new URL("../functions/api/[[path]].js", import.meta.url).href) : null;
const iso = (ms) => new Date(ms).toISOString();
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function d1(db) {
  return {
    prepare(sql) {
      const st = db.prepare(sql); let args = [];
      const o = {
        bind(...a) { args = a; return o; },
        async first() { return st.get(...args) || null; },
        async all() { return { results: st.all(...args) }; },
        async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes) } }; }
      };
      return o;
    },
    async batch(stmts) {
      db.exec("BEGIN");
      try { const out = []; for (const s of stmts) out.push(await s.run()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    }
  };
}
let seq = 0;
function insert(db, table, values) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const row = { ...values };
  for (const c of cols) if (row[c.name] === undefined && c.notnull && c.dflt_value == null && !c.pk) row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : "x" + (++seq);
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => row[k]));
}

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const now = Date.now();
  for (const id of ["u1", "u2", "u3"]) {
    insert(db, "users", { id, email: id + "@x.it", username: "utente" + id, display_name: id, created_at: iso(now), email_verified_at: iso(now) });
    insert(db, "sessions", { token_hash: sha("tok-" + id), user_id: id, expires_at: iso(now + 86400000) });
  }
  insert(db, "slabs", { id: "gr", is_ungraded: 0, is_test: 0, status: "listed", physical_owner_id: "u1", digital_owner_id: "u1" });
  insert(db, "slabs", { id: "raw", is_ungraded: 1, is_test: 0, status: "listed", physical_owner_id: "u1", digital_owner_id: "u1" });
  insert(db, "slabs", { id: "raw2", is_ungraded: 1, is_test: 0, status: "listed", physical_owner_id: "u1", digital_owner_id: "u1" });
  insert(db, "slabs", { id: "paid", is_ungraded: 1, is_test: 0, status: "listed", physical_owner_id: "u1", digital_owner_id: "u1" });
  for (const [id, slab] of [["L-gr", "gr"], ["L-raw", "raw"], ["L-raw2", "raw2"], ["L-paid", "paid"]]) {
    insert(db, "listings", { id, slab_id: slab, seller_id: "u1", price_cents: 1000, status: "active", created_at: iso(now) });
  }
  insert(db, "sales", { id: "s-req", listing_id: "L-raw2", slab_id: "raw2", seller_id: "u1", buyer_id: "u2", status: "requested", created_at: iso(now) });
  insert(db, "sales", { id: "s-paid", listing_id: "L-paid", slab_id: "paid", seller_id: "u1", buyer_id: "u2", status: "paid", created_at: iso(now) });
  return { db, env: { DB: d1(db) } };
}

async function close(env, listingId, who, body) {
  const headers = { "content-type": "application/json" };
  if (who) headers.cookie = "gemint_sid=tok-" + who;
  const res = await api.onRequest({ request: new Request(`https://dreamint.test/api/listings/${listingId}/close`, { method: "POST", headers, body: JSON.stringify(body) }), env });
  return { status: res.status, body: await res.json() };
}

dbTest("serve un motivo valido, e solo il venditore può eliminare il proprio annuncio", async () => {
  const { env, db } = setup();
  assert.equal((await close(env, "L-gr", "u1", {})).body.code, "invalid_reason");
  assert.equal((await close(env, "L-gr", "u1", { reason: "boh" })).status, 400);
  assert.equal((await close(env, "L-gr", "u3", { reason: "not_interested" })).status, 404, "un altro utente non deve poterlo eliminare");
  assert.equal((await close(env, "L-gr", null, { reason: "not_interested" })).status, 401);
  assert.equal((await close(env, "nope", "u1", { reason: "not_interested" })).status, 404);
  assert.equal(db.prepare("SELECT status FROM listings WHERE id = 'L-gr'").get().status, "active", "nessuna modifica dopo i rifiuti");
});

dbTest("«Non più interessato»: annuncio chiuso, carta torna in album, nessun archivio", async () => {
  const { env, db } = setup();
  const r = await close(env, "L-raw", "u1", { reason: "not_interested" });
  assert.equal(r.status, 200);
  assert.equal(r.body.archived, false);
  assert.equal(db.prepare("SELECT status FROM listings WHERE id = 'L-raw'").get().status, "cancelled");
  const slab = db.prepare("SELECT status, archived_at FROM slabs WHERE id = 'raw'").get();
  assert.equal(slab.status, "approved");
  assert.equal(slab.archived_at, null);
  const log = db.prepare("SELECT actor_id, payload FROM audit_logs WHERE action = 'owner_close_listing'").get();
  assert.equal(log.actor_id, "u1");
  assert.equal(JSON.parse(log.payload).reason, "not_interested");
  assert.equal((await close(env, "L-raw", "u1", { reason: "not_interested" })).status, 409, "non si elimina due volte");
});

dbTest("«Venduta fuori»: la non gradata esce anche dall'album, la gradata no (resta da trasferire con il codice)", async () => {
  const { env, db } = setup();
  const raw = await close(env, "L-raw", "u1", { reason: "sold_outside" });
  assert.equal(raw.status, 200);
  assert.equal(raw.body.archived, true);
  assert.ok(db.prepare("SELECT archived_at FROM slabs WHERE id = 'raw'").get().archived_at);
  const gr = await close(env, "L-gr", "u1", { reason: "sold_outside" });
  assert.equal(gr.status, 200);
  assert.equal(gr.body.archived, false);
  assert.equal(gr.body.graded_sold_outside, true);
  const g = db.prepare("SELECT archived_at, physical_owner_id, digital_owner_id, status FROM slabs WHERE id = 'gr'").get();
  assert.equal(g.archived_at, null);
  assert.equal(g.physical_owner_id, "u1");
  assert.equal(g.digital_owner_id, "u1");
  assert.equal(g.status, "approved");
});

dbTest("«Altro»: la nota si salva ripulita; negli altri motivi viene ignorata", async () => {
  const { env, db } = setup();
  await close(env, "L-raw", "u1", { reason: "other", note: "  cambio idea \u0000 per ora  " });
  const p = JSON.parse(db.prepare("SELECT payload FROM audit_logs WHERE entity_id = 'L-raw'").get().payload);
  assert.equal(p.reason, "other");
  assert.ok(p.note.length > 0 && !p.note.includes("\u0000") && p.note.length <= 200);
  await close(env, "L-gr", "u1", { reason: "wrong_listing", note: "ignorata" });
  assert.equal(JSON.parse(db.prepare("SELECT payload FROM audit_logs WHERE entity_id = 'L-gr'").get().payload).note, "");
});

dbTest("richieste di acquisto in corso annullate; con pagamento confermato non si elimina", async () => {
  const { env, db } = setup();
  const r = await close(env, "L-raw2", "u1", { reason: "not_interested" });
  assert.equal(r.status, 200);
  assert.equal(r.body.cancelled_requests, 1);
  assert.equal(db.prepare("SELECT status FROM sales WHERE id = 's-req'").get().status, "cancelled");
  const p = await close(env, "L-paid", "u1", { reason: "not_interested" });
  assert.equal(p.status, 409);
  assert.equal(p.body.code, "listing_not_open");
  assert.equal(db.prepare("SELECT status FROM listings WHERE id = 'L-paid'").get().status, "active");
  assert.equal(db.prepare("SELECT status FROM sales WHERE id = 's-paid'").get().status, "paid");
});
