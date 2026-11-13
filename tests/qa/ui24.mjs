// v24 UI/API test: PayPal notice only for the owner + back photo of ungraded cards.
import fs from "fs";
import { execSync } from "child_process";
import pkg from "/usr/local/lib/pnpm/5/.pnpm/playwright@1.63.0-alpha-2026-08-31/node_modules/playwright/index.js";
const { chromium } = pkg;
const B = process.env.B || "http://localhost:8979", QADB = process.env.QADB || "/workspace/tmp-qa/db-v24", pw = "Passw0rd-local-qa";
const fx = JSON.parse(fs.readFileSync("/workspace/tmp-qa/v23/suites/fixtures.json"));
const d1 = (sql) => JSON.parse(execSync(`cd /workspace/gemint-beta && WRANGLER_CACHE_DIR=/workspace/cf/.cache npx wrangler d1 execute gemint-beta --local --persist-to ${QADB} --json --command "${sql}"`, { stdio: ["ignore", "pipe", "ignore"] }).toString())[0].results;
function client() {
  const c = { cookie: "" };
  c.call = async (method, path, body) => {
    const r = await fetch(B + path, { method, redirect: "manual", headers: { "content-type": "application/json", origin: B, cookie: c.cookie }, body: body == null ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) c.cookie = sc.split(";")[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t.slice(0, 200); }
    return { s: r.status, j, t };
  };
  return c;
}
const out = []; let fail = 0;
const check = (n, ok, info = "") => { out.push((ok ? "PASS " : "FAIL ") + n + (info !== "" ? "  [" + info + "]" : "")); if (!ok) fail++; };
d1("DELETE FROM rate_limits");
const ts = Date.now(), tag = ts.toString(36).slice(-5);
const seller = client(), admin = client(), anon = client();
await seller.call("POST", "/api/auth/signup", { email: `u24s-${ts}@example.com`, password: pw, display_name: `U24 seller ${tag}`, username: `sell_${tag}`, album_public: true });
await admin.call("POST", "/api/auth/signup", { email: `u24a-${ts}@example.com`, password: pw, display_name: `U24 admin ${tag}`, username: `adm_${tag}` });
d1(`UPDATE users SET email_verified_at='2026-11-12T00:00:00.000Z' WHERE email IN ('u24s-${ts}@example.com','u24a-${ts}@example.com')`);
d1(`UPDATE users SET role='admin' WHERE email='u24a-${ts}@example.com'`);
d1("DELETE FROM rate_limits");
const mk = async (n) => {
  const r = await seller.call("POST", "/api/cards", { game: "pokemon", set_name: "QA24", code: n + "/100", name: "Raw24 " + n + " " + tag, language: "ITA", variant: "normal", is_ungraded: true, grader: "NONE", condition: "NM", price_euros: "12", photos: { front: fx.JPEG, back: fx.JPEG } });
  if (!r.j.card) throw new Error("create failed " + r.s + " " + r.t);
  await admin.call("POST", "/api/admin/cards/" + r.j.card.id + "/approve", {});
  return r.j.card.id;
};
const id = await mk(1), id2 = await mk(2);
const asAdmin = (await admin.call("GET", "/api/cards/" + id)).j.card;
check("setup: seller has no PayPal -> card blocked no_paypal (owner view)", (await seller.call("GET", "/api/cards/" + id)).j.card.listing_blocked_reason === "no_paypal");
check("API: anon card has no listing_blocked_reason", !(await anon.call("GET", "/api/cards/" + id)).j.card.listing_blocked_reason);
check("API: admin sees physical_owner_id of the real owner (not own id)", !!asAdmin.physical_owner_id);
// back photo visibility
const ph = async (c, i) => (await fetch(B + `/api/cards/${i}/photo/back?w=224`, { headers: { cookie: c.cookie } })).status;
check("back photo: anon 200 on visible ungraded card", (await ph(anon, id)) === 200);
const alb = await anon.call("GET", `/api/users/sell_${tag}/album`);
const ac = (alb.j.cards || []).find((c) => c.id === id);
check("public album returns back_url for the ungraded card", !!(ac && ac.back_url));
d1(`UPDATE users SET album_public=0 WHERE email='u24s-${ts}@example.com'`);
const albP = await anon.call("GET", `/api/users/sell_${tag}/album`);
check("private album: anon gets no cards -> no back_url leak", !(albP.j.cards || []).length && !/back/.test(JSON.stringify(albP.j.cards || [])));
d1(`UPDATE users SET album_public=1 WHERE email='u24s-${ts}@example.com'`);
await admin.call("DELETE", "/api/admin/cards/" + id2, { reason: "test v24" });
check("back photo: admin_removed card -> anon 404", (await ph(anon, id2)) === 404);
check("back photo: admin_removed card -> admin 200", (await ph(admin, id2)) === 200);
d1(`UPDATE slabs SET is_test=1 WHERE id='${id2}'`);
check("back photo: test card -> anon 404", (await ph(anon, id2)) === 404);

const br = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const errs = [];
async function pageAs(c) {
  const ctx = await br.newContext();
  if (c && c.cookie) { const [k, v] = c.cookie.split("="); await ctx.addCookies([{ name: k, value: v, url: B }]); }
  const pg = await ctx.newPage(); pg.on("pageerror", (e) => errs.push(e.message)); return pg;
}
const st = (pg) => pg.evaluate(() => ({
  notice: document.querySelectorAll(".paypal-needed").length,
  accLink: [...document.querySelectorAll(".paypal-needed a, .tile-paypal a")].filter((a) => /#\/account/.test(a.getAttribute("href"))).length,
  neutral: document.querySelectorAll(".seller-no-paypal").length,
  flip: !!document.querySelector("[data-raw-flip]"),
  backMini: document.querySelectorAll(".raw-back-mini img").length,
  backFlipImg: !!document.querySelector(".raw-face-back img"),
}));
const go = async (pg, h) => { await pg.goto(B + "/" + h); await pg.waitForTimeout(3000); if (await pg.$("[data-album-tab=raw]")) { await pg.click("[data-album-tab=raw]"); await pg.waitForTimeout(1200); } };
// owner
const po = await pageAs(seller);
await go(po, "#/carta/" + id); const o1 = await st(po);
check("owner card page: PayPal notice + link to own account", o1.notice === 1 && o1.accLink === 1, JSON.stringify(o1));
await go(po, "#/collezione"); const o2 = await st(po);
check("owner own album: PayPal notice shown, back mini shown", o2.notice >= 1 && o2.backMini >= 1, JSON.stringify(o2));
await po.screenshot({ path: "/workspace/tmp-qa/v23/ui24-owner-album.png", fullPage: true });
// admin viewing another user's card/album
const pa = await pageAs(admin);
await go(pa, "#/carta/" + id); const a1 = await st(pa);
check("admin on other's card: no PayPal notice/link, neutral note", a1.notice === 0 && a1.accLink === 0 && a1.neutral === 1, JSON.stringify(a1));
await go(pa, "#/u/sell_" + tag); const a2 = await st(pa);
check("admin on other's album /u/: no PayPal notice/link, back mini shown", a2.notice === 0 && a2.accLink === 0 && a2.backMini >= 1, JSON.stringify(a2));
await pa.screenshot({ path: "/workspace/tmp-qa/v23/ui24-admin-other-album.png", fullPage: true });
// other logged user (non admin) + anon
const other = client();
await other.call("POST", "/api/auth/signup", { email: `u24o-${ts}@example.com`, password: pw, display_name: `U24 other ${tag}`, username: `oth_${tag}` });
const pu = await pageAs(other);
await go(pu, "#/carta/" + id); const u1 = await st(pu);
check("other user on card: no PayPal notice/link", u1.notice === 0 && u1.accLink === 0, JSON.stringify(u1));
await go(pu, "#/u/sell_" + tag); const u2 = await st(pu);
check("other user on album: no PayPal notice", u2.notice === 0 && u2.accLink === 0, JSON.stringify(u2));
const pn = await pageAs(null);
await go(pn, "#/carta/" + id); const n1 = await st(pn);
check("anon card page: no PayPal notice, flip with back photo", n1.notice === 0 && n1.flip && n1.backFlipImg, JSON.stringify(n1));
await pn.focus("[data-raw-flip]"); await pn.keyboard.press("Enter"); await pn.waitForTimeout(700);
const fl = await pn.evaluate(() => { const f = document.querySelector("[data-raw-flip]"); return { p: f.getAttribute("aria-pressed"), c: f.classList.contains("is-flipped"), hint: f.querySelector(".raw-flip-hint").textContent }; });
check("flip by keyboard (Enter): aria-pressed true", fl.p === "true" && fl.c, JSON.stringify(fl));
await pn.screenshot({ path: "/workspace/tmp-qa/v23/ui24-anon-card-back.png" });
await pn.click("[data-raw-flip]"); await pn.waitForTimeout(300);
check("flip by click toggles back to front", await pn.evaluate(() => document.querySelector("[data-raw-flip]").getAttribute("aria-pressed")) === "false");
await go(pn, "#/u/sell_" + tag); const n2 = await st(pn);
check("anon public album: back mini thumbnail, no PayPal notice", n2.backMini >= 1 && n2.notice === 0, JSON.stringify(n2));
// missing back -> clean placeholder (simulate: back photo removed from response)
const pm = await pageAs(null);
await pm.route("**/photo/back**", (r) => r.fulfill({ status: 404, body: "{}" }));
await go(pm, "#/u/sell_" + tag);
check("missing back photo (album) -> placeholder text", await pm.evaluate(() => document.querySelectorAll(".raw-back-mini .raw-back-ph").length) >= 1);
await go(pm, "#/carta/" + id);
check("missing back photo (card page) -> placeholder on flip side", await pm.evaluate(() => !!document.querySelector(".raw-face-back .raw-back-ph")));
check("no page errors", errs.length === 0, errs.join(" | "));
await br.close();
console.log(out.join("\n"));
console.log(fail ? `\n${fail} FAILED` : `\nALL ${out.length} PASSED`);
process.exit(fail ? 1 : 0);
