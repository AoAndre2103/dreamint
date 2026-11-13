// v25: every commission text must agree with the FREE/PRO/BUSINESS plans (single source: functions/lib/plans.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { PLANS, freePlanPercent } from "../functions/lib/plans.js";

const root = new URL("../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), "utf8");
const itPct = (bps) => (bps / 100).toFixed(1).replace(/\.0$/, "").replace(".", ",") + "%";
const itEur = (c) => (c / 100).toFixed(2).replace(".", ",") + " €";

test("plans: FREE 2,5% 0 €, PRO 2% 9,90 €, BUSINESS 1,5% 29,90 € (page «Commissioni e abbonamenti»)", () => {
  assert.deepEqual(PLANS.map((p) => [p.id, p.monthly_cents, p.fee_bps]), [["free", 0, 250], ["pro", 990, 200], ["business", 2990, 150]]);
  assert.equal(freePlanPercent(), 2.5);
});

test("public/js/config.js fallback = same plans, feeAfterPercent = FREE rate", () => {
  const ctx = { window: {} };
  vm.runInNewContext(read("public/js/config.js"), ctx);
  const c = ctx.window.GEMINT_CONFIG;
  assert.equal(c.feeAfterPercent, freePlanPercent());
  assert.deepEqual(JSON.parse(JSON.stringify(c.plans)), JSON.parse(JSON.stringify(PLANS)));
});

test("no hard-coded 6,5% / 6.5% anywhere a user can read", () => {
  const files = ["public/index.html", "public/404.html", "public/app.js", "public/js/i18n.js", "public/js/strings-v2.js",
    "public/js/home-v2.js", "public/js/trade-v9.js", "public/js/config.js", ...fs.readdirSync(new URL("public/legal/", root)).map((f) => "public/legal/" + f)];
  for (const f of files) {
    const s = read(f);
    assert.ok(!/6[.,]5\s*(%|&#37;|percent)/i.test(s), f + " mentions 6.5%");
    assert.ok(!/feeAfterPercent\s*\|\|\s*6\.5/.test(s), f + " keeps the 6.5 fallback");
  }
  assert.ok(!/FEE_AFTER_BPS/.test(read("functions/api/[[path]].js")), "server must derive the after-launch rate from the plans");
});

test("legal pages (Termini, FAQ, Regolamento) list exactly the plan rates and prices", () => {
  for (const f of ["termini.html", "faq.html", "regolamento-lancio.html"]) {
    const s = read("public/legal/" + f).replace(/<[^>]+>/g, "");
    for (const p of PLANS) {
      assert.ok(s.includes(p.label), f + " misses " + p.label);
      assert.ok(s.includes(itPct(p.fee_bps)), f + " misses " + itPct(p.fee_bps));
      assert.ok(s.includes(itEur(p.monthly_cents).replace(",00 €", " €")) || s.includes(itEur(p.monthly_cents)), f + " misses " + itEur(p.monthly_cents));
    }
    assert.ok(/non attivi durante la beta/.test(s), f + " must say plans are not active in beta");
  }
});

test("banner/market strings use the plan range, not a single fixed fee", () => {
  const i18n = read("public/js/i18n.js");
  assert.ok(!/\{fee\}%/.test(i18n), "i18n.js still has '{fee}%'");
  assert.ok(/"banner\.body": "In beta nessuna commissione[^"]*\{range\}/.test(i18n));
  assert.ok(/"banner\.body": "No fees in beta[^"]*\{range\}/.test(i18n));
  const s2 = read("public/js/strings-v2.js");
  const free = PLANS[0];
  assert.ok(s2.includes("(" + itPct(free.fee_bps) + " di 100 €)"), "IT example must use the FREE rate");
  assert.ok(s2.includes("(" + (free.fee_bps / 100) + "% of €100)"), "EN example must use the FREE rate");
});
