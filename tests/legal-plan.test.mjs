// v26b: la scelta obbligatoria del piano deve essere spiegata nelle pagine legali e nell'app (IT + EN),
// il selettore non deve avere stili scritti nel codice, e ogni pagina legale ha una data di versione valida.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), "utf8");
const text = (p) => read(p).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

test("Termini e FAQ: scelta del piano obbligatoria, solo preferenza in beta, nessun addebito", () => {
  for (const f of ["termini.html", "faq.html"]) {
    const s = text("public/legal/" + f);
    assert.ok(/devi scegliere (uno dei piani \()?FREE, PRO o BUSINESS/.test(s), f + ": manca l'obbligo di scegliere il piano");
    assert.ok(/già iscritto senza un piano/.test(s), f + ": manca il caso degli iscritti senza piano");
    assert.ok(/(solo una preferenza|solo preferenza)/.test(s), f + ": deve dire che in beta è solo una preferenza");
    assert.ok(/conferma di pagamento/.test(s), f + ": deve dire che PRO/BUSINESS chiedono conferma di pagamento");
  }
});

test("Privacy: elenca il piano scelto tra i dati di account", () => {
  assert.ok(/piano scelto/.test(text("public/legal/privacy.html")));
});

test("Termini, Privacy e Regolamento hanno una data di versione valida (la FAQ non ne ha una)", () => {
  for (const f of ["termini.html", "privacy.html", "regolamento-lancio.html"]) {
    const m = text("public/legal/" + f).match(/Versione:\s*(\d{1,2}) (\w+) (\d{4})/);
    assert.ok(m, f + ": manca «Versione: gg mese aaaa»");
    assert.ok(MESI.includes(m[2]), f + ": mese non valido " + m[2]);
    assert.ok(Number(m[1]) >= 1 && Number(m[1]) <= 31 && Number(m[3]) >= 2026, f + ": data non valida");
  }
});

test("stringhe piano: stesse chiavi in italiano e inglese", () => {
  const ctx = { window: {} }; ctx.self = ctx.window; ctx.globalThis = ctx.window;
  const src = read("public/js/strings-v2.js");
  // le chiavi plan.* compaiono due volte (blocco IT e blocco EN): stesso insieme in entrambi i blocchi
  const keys = [...src.matchAll(/"(plan\.[A-Za-z]+)":/g)].map((m) => m[1]);
  const uniq = [...new Set(keys)];
  assert.ok(uniq.length >= 11, "chiavi plan.* attese >= 11, trovate " + uniq.length);
  for (const k of uniq) assert.equal(keys.filter((x) => x === k).length, 2, k + " deve esistere in IT e in EN");
  for (const k of ["plan.accountTitle", "plan.changed", "plan.exempt"]) assert.ok(uniq.includes(k), "manca " + k);
});

test("selettore del piano: nessuno stile scritto nel codice, solo classi CSS", () => {
  const app = read("public/app.js");
  const start = app.indexOf("function planPickerHtml"), end = app.indexOf("function pagePlanGate");
  assert.ok(start > 0 && end > start);
  const block = app.slice(start, end);
  assert.ok(!/style=/.test(block), "planPickerHtml/accountPlanHtml non devono usare style=");
  assert.ok(!/#[0-9a-fA-F]{6}/.test(block), "niente colori esadecimali nel selettore");
  const gate = app.slice(end, app.indexOf("function bindPlanGate"));
  assert.ok(!/style=/.test(gate), "pagePlanGate non deve usare style=");
  const css = read("public/v2-theme.css");
  for (const c of [".plan-gate", ".plan-recommended", ".pill-recommended", ".plan-account"]) assert.ok(css.includes(c), "manca " + c + " nel CSS");
});

test("profilo: il piano si può cambiare (form + chiamata me/plan) e gli admin vedono la nota di esenzione", () => {
  const app = read("public/app.js");
  assert.ok(/accountPlanHtml\(\)\s*\+/.test(app), "pageAccount deve includere accountPlanHtml()");
  assert.ok(/bindPlanForm\(\);/.test(app), "il render del profilo deve collegare bindPlanForm()");
  assert.ok(/plan_exempt/.test(app.slice(app.indexOf("function accountPlanHtml"), app.indexOf("function bindPlanForm"))));
});

test("index.html: app.js, strings-v2.js e v2-theme.css hanno la stessa versione ?v= (niente cache vecchia)", () => {
  const html = read("public/index.html");
  const v = (re) => (html.match(re) || [])[1];
  const a = v(/app\.js\?v=(\w+)/), b = v(/strings-v2\.js\?v=(\w+)/), c = v(/v2-theme\.css\?v=(\w+)/);
  assert.ok(a && b && c, "manca una versione ?v=");
  assert.ok(a === b && b === c, "le tre versioni devono coincidere: " + [a, b, c].join(" / "));
  assert.ok(!/plan1|plan2/.test(html), "restano versioni vecchie");
});

test("recensioni: Termini, FAQ e Privacy le spiegano (regole, 14 giorni, nessuna modifica)", () => {
  for (const f of ["termini.html", "faq.html"]) {
    const s = text("public/legal/" + f);
    assert.ok(/recension/i.test(s), f + ": mancano le recensioni");
    assert.ok(/60 giorni/.test(s) && /14 giorni/.test(s), f + ": mancano i termini di 60 e 14 giorni");
    assert.ok(/non si (possono|può) modificare/i.test(s), f + ": deve dire che non si modificano");
  }
  assert.ok(/recensioni/.test(text("public/legal/privacy.html")) && /pubbliche/.test(text("public/legal/privacy.html")));
});

test("stringhe rev.*: stesse chiavi in italiano e inglese", () => {
  const keys = [...read("public/js/strings-v2.js").matchAll(/"(rev\.[A-Za-z]+)":/g)].map((m) => m[1]);
  const uniq = [...new Set(keys)];
  assert.ok(uniq.length >= 17, "attese >= 17 chiavi rev.*, trovate " + uniq.length);
  for (const k of uniq) assert.equal(keys.filter((x) => x === k).length, 2, k + " deve esistere in IT e in EN");
});
