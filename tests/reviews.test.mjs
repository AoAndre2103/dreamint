// v27: recensioni. Le regole girano su un vero SQLite in memoria (node:sqlite) con schema.sql, via un piccolo adattatore D1.
// Con Node < 22 node:sqlite non esiste: i test sul database vengono saltati (restano quelli di validazione).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  validateReview, createReview, listUserReviews, reviewStatusForSales, hideReview,
  REVIEW_COMMENT_MAX, REVIEW_REVEAL_DAYS, REVIEW_WINDOW_DAYS
} from "../functions/lib/reviews.js";

let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch (e) { DatabaseSync = null; }
const dbTest = (name, fn) => test(name, { skip: DatabaseSync ? false : "node:sqlite non disponibile (serve Node 22+)" }, fn);

const DAY = 86400000;
const NOW = Date.parse("2026-11-14T12:00:00.000Z");
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
    }
  };
}

// inserisce una riga riempiendo da sola le colonne NOT NULL senza default
let seq = 0;
function insert(db, table, values) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const row = { ...values };
  for (const c of cols) {
    if (row[c.name] === undefined && c.notnull && c.dflt_value == null && !c.pk) row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : "x" + (++seq);
  }
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => row[k]));
}

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  for (const [id, un] of [["seller", "venditore"], ["buyer", "compratore"], ["other", "estraneo"]]) {
    insert(db, "users", { id, email: id + "@x.it", username: un, display_name: id, created_at: iso(NOW) });
  }
  insert(db, "slabs", { id: "slab1", is_test: 0 });
  insert(db, "slabs", { id: "slabT", is_test: 1 });
  const sale = (id, extra) => insert(db, "sales", { id, slab_id: "slab1", seller_id: "seller", buyer_id: "buyer", status: "completed", created_at: iso(NOW - 3 * DAY), received_at: iso(NOW - 2 * DAY), ...extra });
  sale("s1", {});
  sale("sReq", { status: "requested", received_at: null });
  insert(db, "sales", { id: "sTest", slab_id: "slabT", seller_id: "seller", buyer_id: "buyer", status: "completed", created_at: iso(NOW - DAY), received_at: iso(NOW - DAY) });
  sale("sOld", { created_at: iso(NOW - 200 * DAY), received_at: iso(NOW - (REVIEW_WINDOW_DAYS + 5) * DAY) });
  return { db, d: d1(db) };
}

test("validateReview: voto 1-5 intero, commento ripulito e limitato", () => {
  assert.equal(validateReview({ rating: 5 }).ok, true);
  assert.equal(validateReview({ rating: "4", comment: "  ottimo  " }).comment, "ottimo");
  for (const bad of [undefined, null, 0, 6, 3.5, "abc", "", true, [], {}, "5.0"]) {
    const v = validateReview({ rating: bad });
    assert.equal(v.ok, false, "voto non valido accettato: " + JSON.stringify(bad));
    assert.equal(v.code, "invalid_rating");
  }
  assert.equal(validateReview(null).ok, false);
  assert.equal(validateReview({ rating: 3, comment: "x".repeat(REVIEW_COMMENT_MAX) }).ok, true);
  assert.equal(validateReview({ rating: 3, comment: "x".repeat(REVIEW_COMMENT_MAX + 1) }).code, "comment_too_long");
  assert.equal(validateReview({ rating: 3, comment: "a\u0000b\r\n\r\n\r\n\r\nc" }).comment, "ab\n\nc");
  assert.equal(validateReview({ rating: 3, comment: "   " }).comment, null);
  assert.equal(validateReview({ rating: 3, comment: 42 }).comment, null);
});

dbTest("createReview: compratore e venditore recensiscono una volta sola, solo a vendita completata", async () => {
  const { d } = setup();
  const ok = await createReview(d, { saleId: "s1", userId: "buyer", body: { rating: 5, comment: "Tutto perfetto" }, now: NOW });
  assert.equal(ok.status, 201);
  assert.equal(ok.reviewee_id, "seller");
  assert.equal(ok.body.review.reviewee_role, "seller");
  assert.equal((await createReview(d, { saleId: "s1", userId: "buyer", body: { rating: 1 }, now: NOW })).body.code, "already_reviewed");
  const back = await createReview(d, { saleId: "s1", userId: "seller", body: { rating: 4 }, now: NOW });
  assert.equal(back.status, 201);
  assert.equal(back.body.review.reviewee_role, "buyer");
  const o = await createReview(d, { saleId: "s1", userId: "other", body: { rating: 5 }, now: NOW });
  assert.equal(o.status, 404, "un estraneo non deve nemmeno sapere che la vendita esiste");
  assert.equal((await createReview(d, { saleId: "nope", userId: "buyer", body: { rating: 5 }, now: NOW })).status, 404);
  assert.equal((await createReview(d, { saleId: "sReq", userId: "buyer", body: { rating: 5 }, now: NOW })).body.code, "not_completed");
  assert.equal((await createReview(d, { saleId: "sTest", userId: "buyer", body: { rating: 5 }, now: NOW })).body.code, "test_sale");
  assert.equal((await createReview(d, { saleId: "sOld", userId: "buyer", body: { rating: 5 }, now: NOW })).body.code, "window_closed");
  assert.equal((await createReview(d, { saleId: "s1", userId: "other", body: { rating: 9 }, now: NOW })).body.code, "invalid_rating");
});

dbTest("visibilità: una recensione è pubblica solo quando ha recensito anche l'altra parte o dopo il periodo di attesa", async () => {
  const { d } = setup();
  await createReview(d, { saleId: "s1", userId: "buyer", body: { rating: 5, comment: "Ottimo venditore" }, now: NOW });
  let l = await listUserReviews(d, "seller", { now: NOW });
  assert.equal(l.summary.count, 0, "ancora nascosta: il venditore non ha recensito");
  assert.equal(l.reviews.length, 0);
  // dopo 13 giorni è ancora nascosta, dopo 14 compare
  assert.equal((await listUserReviews(d, "seller", { now: NOW + (REVIEW_REVEAL_DAYS - 1) * DAY })).summary.count, 0);
  assert.equal((await listUserReviews(d, "seller", { now: NOW + REVIEW_REVEAL_DAYS * DAY })).summary.count, 1);
  // se risponde il venditore, diventano visibili subito entrambe
  await createReview(d, { saleId: "s1", userId: "seller", body: { rating: 3 }, now: NOW });
  l = await listUserReviews(d, "seller", { now: NOW });
  assert.equal(l.summary.count, 1);
  assert.equal(l.summary.avg, 5);
  assert.equal(l.reviews[0].reviewer_username, "compratore");
  assert.equal(l.reviews[0].comment, "Ottimo venditore");
  const b = await listUserReviews(d, "buyer", { now: NOW });
  assert.equal(b.summary.count, 1);
  assert.equal(b.summary.as_buyer.count, 1);
  assert.equal(b.summary.as_seller.count, 0);
  assert.equal(JSON.stringify(l).includes("buyer@x.it"), false, "non si espone l'email");
});

dbTest("riepilogo: media e conteggi per ruolo", async () => {
  const { db, d } = setup();
  insert(db, "sales", { id: "s2", slab_id: "slab1", seller_id: "seller", buyer_id: "other", status: "completed", created_at: iso(NOW - DAY), received_at: iso(NOW - DAY) });
  insert(db, "sales", { id: "s3", slab_id: "slab1", seller_id: "other", buyer_id: "seller", status: "completed", created_at: iso(NOW - DAY), received_at: iso(NOW - DAY) });
  await createReview(d, { saleId: "s1", userId: "buyer", body: { rating: 5 }, now: NOW });
  await createReview(d, { saleId: "s2", userId: "other", body: { rating: 4 }, now: NOW });
  await createReview(d, { saleId: "s3", userId: "other", body: { rating: 2 }, now: NOW }); // seller come acquirente
  const later = NOW + REVIEW_REVEAL_DAYS * DAY;
  const s = (await listUserReviews(d, "seller", { now: later })).summary;
  assert.equal(s.count, 3);
  assert.equal(s.avg, 3.7);
  assert.deepEqual(s.as_seller, { count: 2, avg: 4.5 });
  assert.deepEqual(s.as_buyer, { count: 1, avg: 2 });
  assert.equal((await listUserReviews(d, "estraneo", { now: later })).summary.avg, null);
});

dbTest("hideReview: l'admin nasconde, sparisce da elenco e media; non si nasconde due volte", async () => {
  const { d } = setup();
  const r = await createReview(d, { saleId: "s1", userId: "buyer", body: { rating: 1, comment: "insulto" }, now: NOW });
  const later = NOW + REVIEW_REVEAL_DAYS * DAY;
  assert.equal((await listUserReviews(d, "seller", { now: later })).summary.count, 1);
  assert.equal((await hideReview(d, r.body.review.id, "admin1", later)).status, 200);
  const l = await listUserReviews(d, "seller", { now: later });
  assert.equal(l.summary.count, 0);
  assert.equal(l.reviews.length, 0);
  assert.equal((await hideReview(d, r.body.review.id, "admin1", later)).body.code, "already_hidden");
  assert.equal((await hideReview(d, "nope", "admin1", later)).status, 404);
});

dbTest("reviewStatusForSales: mia recensione e possibilità di scriverla", async () => {
  const { d } = setup();
  let st = await reviewStatusForSales(d, ["s1", "sTest", "sOld"], "buyer", NOW);
  assert.deepEqual(st.s1, { mine: null, can_review: true });
  assert.equal(st.sTest.can_review, false);
  assert.equal(st.sOld.can_review, false);
  await createReview(d, { saleId: "s1", userId: "buyer", body: { rating: 4, comment: "ok" }, now: NOW });
  st = await reviewStatusForSales(d, ["s1"], "buyer", NOW);
  assert.equal(st.s1.can_review, false);
  assert.equal(st.s1.mine.rating, 4);
  assert.equal(st.s1.mine.comment, "ok");
  st = await reviewStatusForSales(d, ["s1"], "seller", NOW);
  assert.equal(st.s1.mine, null, "il venditore non vede la recensione scritta dal compratore tra le sue");
  assert.deepEqual(await reviewStatusForSales(d, [], "buyer", NOW), {});
});
