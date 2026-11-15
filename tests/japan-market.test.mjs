// v28: sezione «Carte giapponesi» del mercato: GET /api/market?language=JPN (API vera + SQLite in memoria, Node 22).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) { DatabaseSync = null; }
const dbTest = (name, fn) => test(name, { skip: DatabaseSync ? false : "node:sqlite non disponibile (serve Node 22+)" }, fn);
const api = DatabaseSync ? await import(new URL("../functions/api/[[path]].js", import.meta.url).href) : null;
const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const iso = (ms) => new Date(ms).toISOString();

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
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; }
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
  db.exec(read("schema.sql"));
  const now = Date.now();
  insert(db, "users", { id: "seller", email: "s@x.it", username: "venditore", display_name: "Venditore", created_at: iso(now) });
  // (id modello, lingua, id carta, non gradata?) -> una carta per ogni combinazione
  const cards = [
    ["mJ1", "JPN", "gJ1", 0], ["mJ2", "JPN", "rJ2", 1],
    ["mI1", "ITA", "gI1", 0], ["mE1", "ENG", "rE1", 1]
  ];
  for (const [mid, lang, sid, raw] of cards) {
    insert(db, "card_models", { id: mid, game: "pokemon", set_name: "Set " + mid, code_printed: "1/1", code_normalized: "1/1", name: "Carta " + mid, language: lang, variant: "normal", slug: "slug-" + mid, created_at: iso(now) });
    insert(db, "slabs", { id: sid, card_model_id: mid, is_ungraded: raw, is_test: 0, status: "listed", physical_owner_id: "seller", digital_owner_id: "seller", archived_at: null });
    insert(db, "listings", { id: "L-" + sid, slab_id: sid, seller_id: "seller", price_cents: 5000, status: "active", created_at: iso(now) });
  }
  return { env: { DB: d1(db) } };
}

async function market(env, qs) {
  const res = await api.onRequest({ request: new Request("https://dreamint.test/api/market" + qs), env });
  return { status: res.status, body: await res.json() };
}

dbTest("market?language=JPN mostra solo carte giapponesi, per sezione", async () => {
  const { env } = setup();
  const all = await market(env, "");
  assert.equal(all.body.listings.length, 4, "senza filtro si vedono tutte");
  const jpG = await market(env, "?section=graded&language=JPN");
  assert.deepEqual(jpG.body.listings.map((l) => l.language + ":" + l.slab_id), ["JPN:gJ1"]);
  const jpR = await market(env, "?section=ungraded&language=JPN");
  assert.deepEqual(jpR.body.listings.map((l) => l.language + ":" + l.slab_id), ["JPN:rJ2"]);
  const jpAll = await market(env, "?language=jpn");
  assert.equal(jpAll.body.listings.length, 2, "il codice lingua non distingue maiuscole/minuscole");
  assert.ok(jpAll.body.listings.every((l) => l.language === "JPN"));
});

dbTest("market: lingue valide filtrano, lingue inventate danno 400, senza filtro resta tutto come prima", async () => {
  const { env } = setup();
  assert.equal((await market(env, "?language=ITA")).body.listings.length, 1);
  assert.equal((await market(env, "?language=KOR")).body.listings.length, 0);
  const bad = await market(env, "?language=XXX");
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "invalid_language");
  assert.equal((await market(env, "?language=JPN'%20OR%201=1")).status, 400, "niente iniezioni: la lingua è una lista chiusa");
  assert.equal((await market(env, "?section=graded")).body.listings.length, 2);
});

test("carte giapponesi: nessuna sezione o pulsante separato, vecchi link aprono Market", () => {
  const app = read("public/app.js"), i18n = read("public/js/i18n.js"), strings = read("public/js/strings-v2.js"), html = read("public/index.html");
  // La lingua JPN è metadato di carta: non è più una categoria obbligatoria di navigazione.
  assert.match(app, /if \(p\[0\] === "giapponesi"\)/);
  assert.match(app, /go\("#\/market" \+ \(p\[1\] === "non-gradate"/);
  assert.doesNotMatch(app, /href: "#\/giapponesi"/);
  assert.doesNotMatch(html, /href="#\/giapponesi"/);
  assert.equal((i18n.match(/"nav.gallery": "Market"/g) || []).length, 2);
  // Traduzioni storiche possono restare come compatibilità, ma non sono voci visibili.
  assert.ok(strings.includes('"f.japan"'));
});
