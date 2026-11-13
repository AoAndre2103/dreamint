// v25: rendered pages never show 6,5%; fallback banner shows the plan range.
import pkg from "/usr/local/lib/pnpm/5/.pnpm/playwright@1.63.0-alpha-2026-08-31/node_modules/playwright/index.js";
const B = process.env.B || "http://localhost:8979";
const br = await pkg.chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
let fail = 0; const out = []; const errs = [];
const check = (n, ok, info = "") => { out.push((ok ? "PASS " : "FAIL ") + n + (info ? "  [" + info + "]" : "")); if (!ok) fail++; };
const routes = ["/", "/#/commissioni", "/#/gradate", "/#/non-gradate", "/#/assistenza", "/legal/termini", "/legal/faq", "/legal/regolamento-lancio", "/legal/privacy"];
for (const lang of ["it", "en"]) {
  const ctx = await br.newContext(); await ctx.addInitScript((l) => { try { localStorage.setItem("gemint_lang", l); localStorage.setItem("lang", l); } catch (e) {} }, lang);
  const pg = await ctx.newPage(); pg.on("pageerror", (e) => errs.push(e.message));
  for (const r of routes) {
    await pg.goto(B + r); await pg.waitForTimeout(1800);
    const t = await pg.evaluate(() => document.body.innerText);
    check(`${lang} ${r}: no 6,5%`, !/6[.,]5\s*%/.test(t));
    if (r === "/#/commissioni") check(`${lang} ${r}: shows 2,5 / 2 / 1,5 %`, /2[.,]5\s*%/.test(t) && /1[.,]5\s*%/.test(t) && /\b2\s*%/.test(t));
  }
  await ctx.close();
}
// fallback banner (home-v2.js not loaded)
const ctx = await br.newContext(); const pg = await ctx.newPage();
await pg.route("**/js/home-v2.js*", (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
await pg.goto(B + "/"); await pg.waitForTimeout(2500);
const bt = await pg.evaluate(() => document.getElementById("launch-banner")?.innerText || "");
check("fallback banner: plan range 1,5%–2,5%, beta no fees, no 6,5", /1,5%–2,5%/.test(bt) && /In beta nessuna commissione/.test(bt) && !/6[.,]5/.test(bt), bt.slice(0, 220));
check("no page errors", errs.length === 0, errs.join(" | "));
await br.close();
console.log(out.join("\n")); console.log(fail ? `\n${fail} FAILED` : `\nALL ${out.length} PASSED`); process.exit(fail ? 1 : 0);
