// v27b: scelta chiara Pubblico/Privato nell'album e «Venduta fuori» sulla miniatura delle non gradate.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const app = read("public/app.js");
const i18n = read("public/js/i18n.js");

test("album: scelta esplicita Pubblico/Privato (radio), non più la casella con l'etichetta dello stato", () => {
  assert.ok(!/album-public-toggle/.test(app), "la vecchia casella è ancora nel codice");
  assert.ok(/name="album-visibility"/.test(app) && /value="' \+ kind/.test(app));
  assert.ok(/album-privacy-status/.test(app), "manca la riga che dice lo stato attuale");
});

test("testi album: spiegano cosa vedono gli altri e non dicono più che il profilo privato è invisibile", () => {
  assert.ok(!/il profilo non è visibile/i.test(i18n) && !/the profile is not visible/i.test(i18n));
  const keys = [...i18n.matchAll(/"(album\.(?:stateNow|statePublic|statePrivate|optPublic|optPublicHint|optPrivate|optPrivateHint))":/g)].map((m) => m[1]);
  for (const k of new Set(keys)) assert.equal(keys.filter((x) => x === k).length, 2, k + " deve esistere in IT e in EN");
  assert.equal(new Set(keys).size, 7, "attese 7 chiavi nuove, trovate " + new Set(keys).size);
  const hint = (i18n.match(/"album\.privacyHint": "([^"]*)"/) || [])[1] || "";
  assert.ok(/Pubblico:/.test(hint) && /Privato:/.test(hint) && /senza carte/.test(hint));
});

test("miniatura e pagina carta: «Elimina annuncio» solo per il proprietario con annuncio attivo, con menu dei motivi", () => {
  const ok = app.slice(app.indexOf("function closeListingTileOk"), app.indexOf("function openCloseListingDialog"));
  assert.ok(/c\.listing_id && c\.listing_status === "active"/.test(ok), "solo annunci attivi");
  assert.ok(/opts\.public \|\| !opts\.owner/.test(ok), "niente pulsante sulle pagine pubbliche");
  assert.ok(/CLOSE_REASONS = \["sold_outside", "not_interested", "wrong_listing", "other"\]/.test(app));
  assert.ok(!/name="reason"[^>]*checked/.test(app), "nessun motivo preselezionato, in particolare non «venduta fuori»");
  assert.ok(/listings\/" \+ encodeURIComponent\(listingId\) \+ "\/close"/.test(app));
  assert.ok((app.match(/bindCloseListingButtons\(\$app\);/g) || []).length === 2, "deve essere collegato nell'album e nella pagina carta");
  assert.ok(!/data-sold-outside/.test(app), "il vecchio pulsante diretto «Venduta fuori» sulla miniatura è stato tolto");
});

test("stringhe «Elimina annuncio»: stesse chiavi in italiano e inglese, motivi nell'ordine giusto", () => {
  const keys = [...i18n.matchAll(/"(close\.[A-Za-z_.]+)":/g)].map((m) => m[1]);
  const uniq = [...new Set(keys)];
  assert.equal(uniq.length, 17, "attese 17 chiavi close.*, trovate " + uniq.length);
  for (const k of uniq) assert.equal(keys.filter((x) => x === k).length, 2, k + " deve esistere in IT e in EN");
  const it = i18n.slice(i18n.indexOf('"close.btn"'));
  const order = ["close.r.sold_outside", "close.r.not_interested", "close.r.wrong_listing", "close.r.other"].map((k) => it.indexOf('"' + k + '"'));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])));
});
