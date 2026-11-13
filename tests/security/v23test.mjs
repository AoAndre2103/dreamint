// Local test v23: admin sees/searches private albums (and accounts without username), admin soft
// removal of listings/cards, POST /api/cards double-submit dedup, admin notifications to every admin.
import fs from "fs";
import { execSync } from "child_process";
const B = process.env.B || "http://localhost:8977";
const QADB = process.env.QADB || ".qa-tmp/db";
const NOTIFY_TO = ((fs.readFileSync("./wrangler.toml", "utf8").match(/^NOTIFY_EMAIL\s*=\s*"([^"]*)"/m) || [])[1] || "").toLowerCase();
const MAILS = process.env.MAILS || ".qa-tmp/v23/mails.jsonl";
const fx = JSON.parse(fs.readFileSync(new URL("./fixtures.json", import.meta.url)));
const pw = "Passw0rd-local-qa";
const d1 = (sql) => JSON.parse(execSync(`cd . && npx wrangler d1 execute gemint-beta --local --persist-to ${QADB} --json --command "${sql}"`, { stdio: ["ignore", "pipe", "ignore"] }).toString())[0].results;
function client() {
  const c = { cookie: "" };
  c.call = async (method, path, body, headers = {}) => {
    const r = await fetch(B + path, { method, redirect: "manual", headers: { "content-type": "application/json", origin: B, cookie: c.cookie, ...headers }, body: body == null ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) c.cookie = sc.split(";")[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t.slice(0, 200); }
    return { s: r.status, j, t };
  };
  return c;
}
const out = []; let fail = 0;
const check = (n, ok, info = "") => { out.push((ok ? "PASS " : "FAIL ") + n + (info !== "" ? "  [" + info + "]" : "")); if (!ok) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
d1("DELETE FROM rate_limits");
const ts = Date.now(), tag = ts.toString(36).slice(-5);
const admin = client(), admin2 = client(), seller = client(), buyer = client(), user = client(), anon = client(), nouser = client();
const mk = async (c, n, extra = {}) => {
  c.email = `t23${n}-${ts}@example.com`;
  c.username = `t23${n}_${tag}`.slice(0, 20);
  await c.call("POST", "/api/auth/signup", { email: c.email, password: pw, display_name: extra.display_name || n, username: c.username, plan: "free", album_public: !!extra.public });
};
await mk(admin, "adm"); await mk(admin2, "nasoadm", { display_name: "Naso " + tag });
await mk(seller, "sel", { public: false }); await mk(buyer, "buy"); await mk(user, "usr");
await mk(nouser, "nou", { display_name: "Nasino " + tag });
d1(`UPDATE users SET email_verified_at='2026-11-12T00:00:00.000Z' WHERE email LIKE 't23%-${ts}@example.com'`);
d1(`UPDATE users SET role='admin' WHERE email IN ('${admin.email}','${admin2.email}')`);
// admin2 = "Naso": admin with no username and a private album (as in production)
d1(`UPDATE users SET username=NULL, album_public=0 WHERE email IN ('${admin2.email}','${nouser.email}')`);
d1(`UPDATE users SET album_public=0 WHERE email='${seller.email}'`);
const uid = (c) => d1(`SELECT id FROM users WHERE email='${c.email}'`)[0].id;
const ADM2 = uid(admin2), NOU = uid(nouser);
// a non-admin-reserved TLD admin must be skipped by notifications
const fakeLocal = `qa-local-${tag}@gemint.local`;
d1(`INSERT INTO users (id, email, password_hash, password_salt, display_name, role, created_at) VALUES ('t23-local-${tag}', '${fakeLocal}', 'x', 'x', 'Local', 'admin', '2026-11-13T00:00:00.000Z')`);

// ---------- 1. search ----------
const sAnon = await anon.call("GET", `/api/users/search?q=naso`);
// spec 06:34: private profiles ARE findable (flag private, no card count); no-username accounts never.
check("anon search 'naso': no no-username account, private ones flagged without card count", sAnon.s === 200 && !sAnon.j.users.some((u) => (u.album_ref || "").startsWith("~") || !u.username || (u.private && u.cards_count != null)) && !sAnon.j.admin_view, sAnon.s);
const sUser = await user.call("GET", `/api/users/search?q=${tag}`);
const selU = (sUser.j.users || []).find((u) => u.username === seller.username);
check("user search: private profile FOUND with private:true, no card count", sUser.s === 200 && selU && selU.private === true && selU.cards_count === null && !sUser.j.admin_view, JSON.stringify(sUser.j).slice(0, 160));
const selA = ((await anon.call("GET", `/api/users/search?q=${seller.username}`)).j.users || []).find((u) => u.username === seller.username);
check("anon search: private profile found, private:true", selA && selA.private === true && selA.cards_count === null);
check("user search: no display_name / id leak", sUser.j.users.every((u) => u.display_name === undefined && !String(u.album_ref || "").startsWith("~") && u.id === undefined));
const sAdm = await admin.call("GET", `/api/users/search?q=naso`);
const naso = (sAdm.j.users || []).find((u) => u.album_ref === "~" + ADM2);
check("admin search 'naso' finds the other admin (no username, private)", sAdm.s === 200 && sAdm.j.admin_view === true && naso && naso.private === true && naso.is_admin === true && naso.username === null, JSON.stringify(sAdm.j).slice(0, 200));
check("admin search matches display name of an account without username", ((await admin.call("GET", `/api/users/search?q=nasino ${tag}`)).j.users || []).some((u) => u.album_ref === "~" + NOU));
const sAdm2 = await admin.call("GET", `/api/users/search?q=${seller.username}`);
const selRes = (sAdm2.j.users || []).find((u) => u.username === seller.username);
check("admin search finds private album by username, private:true", selRes && selRes.private === true && selRes.album_ref === seller.username);
check("search q too short still 400 for admin", (await admin.call("GET", "/api/users/search?q=a")).s === 400);

// ---------- 2. album ----------
const raw = (n, extra = {}) => ({ game: "pokemon", set_name: "QA23", code: "2" + n + "/100", name: "Raw23 " + n, language: "ITA", variant: "normal", is_ungraded: true, grader: "NONE", condition: "NM", price_euros: "12", photos: { front: fx.JPEG, back: fx.JPEG }, ...extra });
await seller.call("PATCH", "/api/me", { paypal_email: `pp-t23sel-${ts}@example.com` });
const approved = async (n) => {
  const r = await seller.call("POST", "/api/cards", raw(n));
  const ap = await admin.call("POST", "/api/admin/cards/" + r.j.card.id + "/approve", {});
  if (ap.s !== 200) throw new Error("approve failed " + ap.s + " " + ap.t);
  return r.j.card.id;
};
const c1 = await approved(1), c2 = await approved(2), c3 = await approved(3);
for (const [who, label] of [[anon, "anon"], [user, "user"]]) {
  const r = await who.call("GET", `/api/users/${seller.username}/album`);
  check(`${label}: private profile -> 200 private:true, NO cards, no count`, r.s === 200 && r.j.private === true && r.j.cards.length === 0 && r.j.cards_count === null && !r.t.includes(c1) && !r.t.includes("Raw23"), r.s + " " + String(r.t).slice(0, 100));
}
const own = await seller.call("GET", `/api/users/${seller.username}/album`);
check("owner: own private album -> 200 with cards, owner_view, no admin fields", own.s === 200 && own.j.private === true && own.j.owner_view === true && own.j.cards.length === 3 && own.j.admin_view === undefined && own.j.cards.every((c) => c.listing_id === undefined));
const aAlb = await admin.call("GET", `/api/users/${seller.username}/album`);
check("admin: private album -> 200 private:true admin_view", aAlb.s === 200 && aAlb.j.private === true && aAlb.j.admin_view === true && aAlb.j.cards.length === 3, aAlb.s + " " + String(aAlb.t).slice(0, 120));
const l1 = (aAlb.j.cards || []).find((c) => c.id === c1);
check("admin album: listing_id for cards on sale", l1 && l1.on_sale === true && !!l1.listing_id);
check("anon: ~id album -> 404", (await anon.call("GET", `/api/users/~${ADM2}/album`)).s === 404);
check("user: ~id album -> 404", (await user.call("GET", `/api/users/~${ADM2}/album`)).s === 404);
const aNaso = await admin.call("GET", `/api/users/~${ADM2}/album`);
check("admin: album of admin without username via ~id -> 200", aNaso.s === 200 && aNaso.j.private === true && aNaso.j.username === null && aNaso.j.album_ref === "~" + ADM2, aNaso.s);
check("admin: unknown ~id -> 404", (await admin.call("GET", `/api/users/~00000000-0000-0000-0000-000000000000/album`)).s === 404);
d1(`UPDATE users SET album_public=1 WHERE email='${seller.email}'`);
const pAlb = await anon.call("GET", `/api/users/${seller.username}/album`);
check("public album for anon: no admin fields / listing ids", pAlb.s === 200 && pAlb.j.admin_view === undefined && pAlb.j.private === undefined && pAlb.j.cards.every((c) => c.listing_id === undefined));
d1(`UPDATE users SET album_public=0 WHERE email='${seller.email}'`);

// ---------- 3. admin removal ----------
check("remove listing: anon -> 401", (await anon.call("DELETE", `/api/admin/listings/${l1.listing_id}`)).s === 401);
check("remove listing: user -> 403", (await user.call("DELETE", `/api/admin/listings/${l1.listing_id}`)).s === 403);
check("remove listing: owner (non admin) -> 403", (await seller.call("DELETE", `/api/admin/listings/${l1.listing_id}`)).s === 403);
check("remove listing: cross-origin -> 403", (await admin.call("DELETE", `/api/admin/listings/${l1.listing_id}`, null, { origin: "https://evil.example" })).s === 403);
check("remove card: user -> 403", (await user.call("DELETE", `/api/admin/cards/${c1}`)).s === 403);
await buyer.call("PATCH", "/api/me", { paypal_email: `pp-t23buy-${ts}@example.com` });
const ship = { shipping_method: "inpost_locker", name: "Buyer", phone: "3331234567", point_code: "ABC123" };
const rq = await buyer.call("POST", `/api/listings/${l1.listing_id}/request`, ship);
check("setup: buyer request on listing 1", rq.s === 201 || rq.s === 200, rq.s + " " + String(rq.t).slice(0, 100));
const rl = await admin.call("DELETE", `/api/admin/listings/${l1.listing_id}`);
check("admin removes listing -> 200 cancelled", rl.s === 200 && rl.j.status === "cancelled", rl.s + " " + String(rl.t).slice(0, 150));
check("listing cancelled + unpaid request cancelled", d1(`SELECT status FROM listings WHERE id='${l1.listing_id}'`)[0].status === "cancelled"
  && d1(`SELECT status FROM sales WHERE id='${rq.j.sale && rq.j.sale.id}'`)[0].status === "cancelled");
check("card back to approved (not listed), still in album", d1(`SELECT status, archived_at FROM slabs WHERE id='${c1}'`)[0].status === "approved");
check("audit row admin_remove_listing", d1(`SELECT COUNT(*) n FROM audit_logs WHERE action='admin_remove_listing' AND entity_id='${l1.listing_id}'`)[0].n === 1);
check("market no longer shows the listing", !((await anon.call("GET", "/api/market")).j.listings || []).some((l) => l.id === l1.listing_id));
check("remove listing twice -> 409", (await admin.call("DELETE", `/api/admin/listings/${l1.listing_id}`)).s === 409);
check("remove unknown listing -> 404", (await admin.call("DELETE", `/api/admin/listings/nope-${tag}`)).s === 404);
// paid sale blocks removal
const l2 = d1(`SELECT id FROM listings WHERE slab_id='${c2}' AND status='active'`)[0].id;
const rq2 = await buyer.call("POST", `/api/listings/${l2}/request`, ship);
await seller.call("POST", `/api/sales/${rq2.j.sale.id}/accept`);
const mp = await seller.call("POST", `/api/sales/${rq2.j.sale.id}/mark-paid`);
check("setup: sale 2 paid", d1(`SELECT status FROM sales WHERE id='${rq2.j.sale.id}'`)[0].status === "paid", mp.s + " " + String(mp.t).slice(0, 100));
check("paid sale: remove listing -> 409, nothing changed", (await admin.call("DELETE", `/api/admin/listings/${l2}`)).s === 409 && d1(`SELECT status FROM listings WHERE id='${l2}'`)[0].status === "reserved");
check("paid sale: remove card -> 409, card untouched", (await admin.call("DELETE", `/api/admin/cards/${c2}`)).s === 409 && d1(`SELECT archived_at FROM slabs WHERE id='${c2}'`)[0].archived_at === null
  && d1(`SELECT COUNT(*) n FROM audit_logs WHERE action='admin_remove_card' AND entity_id='${c2}'`)[0].n === 0);
// card removal with active listing + pending request
const l3 = d1(`SELECT id FROM listings WHERE slab_id='${c3}' AND status='active'`)[0].id;
const rq3 = await buyer.call("POST", `/api/listings/${l3}/request`, ship);
const rc = await admin.call("DELETE", `/api/admin/cards/${c3}`);
check("admin removes card -> 200 soft archive", rc.s === 200 && rc.j.archived_reason === "admin_removed" && rc.j.cancelled_listings === 1, rc.s + " " + String(rc.t).slice(0, 150));
const s3 = d1(`SELECT archived_at, archived_reason, status FROM slabs WHERE id='${c3}'`)[0];
check("card row kept (no DELETE), archived admin_removed", s3 && s3.archived_at && s3.archived_reason === "admin_removed");
check("card listings cancelled + request cancelled", d1(`SELECT status FROM listings WHERE id='${l3}'`)[0].status === "cancelled" && d1(`SELECT status FROM sales WHERE id='${rq3.j.sale.id}'`)[0].status === "cancelled");
check("removed card leaves owner album and admin album", !(await seller.call("GET", "/api/cards")).j.cards.some((c) => c.id === c3)
  && !((await admin.call("GET", `/api/users/${seller.username}/album`)).j.cards || []).some((c) => c.id === c3));
check("audit row admin_remove_card", d1(`SELECT COUNT(*) n FROM audit_logs WHERE action='admin_remove_card' AND entity_id='${c3}'`)[0].n === 1);
check("remove card twice -> 409", (await admin.call("DELETE", `/api/admin/cards/${c3}`)).s === 409);
check("remove unknown card -> 404", (await admin.call("DELETE", `/api/admin/cards/nope-${tag}`)).s === 404);

// ---------- 5. removed APPROVED graded card disappears for non-admins (detail, photo, /c/, cert search, recent) ----------
const tc = await admin.call("POST", "/api/admin/test-card", { email: seller.email });
const gid = tc.j.card && tc.j.card.id, gcert = tc.j.card && tc.j.card.certificate_no;
// local fixture only: make it a normal (non-test) opened graded card so visibility is not due to is_test
d1(`UPDATE slabs SET is_test=0, opened_at='2026-11-12T00:00:00.000Z', status='approved' WHERE id='${gid}'`);
check("setup: approved graded card visible to anon (/c/ 200, detail 200)", (await anon.call("GET", `/c/${gid}`)).s === 200 && (await anon.call("GET", `/api/cards/${gid}`)).s === 200);
const glist = d1(`SELECT 1 FROM slabs WHERE id='${gid}'`).length === 1;
const rg = await admin.call("DELETE", `/api/admin/cards/${gid}`);
check("admin removes an APPROVED graded card -> 200", rg.s === 200 && rg.j.archived_reason === "admin_removed", rg.s);
for (const [who, label] of [[anon, "anon"], [user, "user"], [seller, "owner"]]) {
  check(`${label}: /c/ of removed card -> 404`, (await who.call("GET", `/c/${gid}`)).s === 404);
  check(`${label}: /api/cards/:id of removed card -> 404`, (await who.call("GET", `/api/cards/${gid}`)).s === 404);
  check(`${label}: /api/copies/:id of removed card -> 404`, (await who.call("GET", `/api/copies/${gid}`)).s === 404);
}
check("anon: public card endpoint -> 404", (await anon.call("GET", `/api/public/cards/${gid}`)).s === 404);
check("cert search no longer finds it", !((await anon.call("GET", `/api/search/cert?q=${encodeURIComponent(gcert)}`)).t || "").includes(gid));
check("recent feed no longer shows it", !((await anon.call("GET", "/api/recent")).t || "").includes(gid));
check("admin still sees removed card detail (200)", (await admin.call("GET", `/api/cards/${gid}`)).s === 200 && (await admin.call("GET", `/api/admin/cards/${gid}`)).s === 200);
const dupQ = await seller.call("POST", "/api/cards", raw(8));
await admin.call("DELETE", `/api/admin/cards/${dupQ.j.card.id}`);
check("removed in-review request leaves the admin queue", !((await admin.call("GET", "/api/admin/queue")).t || "").includes(dupQ.j.card.id));

// ---------- 6. Assistenza ----------
d1("DELETE FROM rate_limits");
check("support: anon -> 401", (await anon.call("POST", "/api/support", { subject: "Ciao", category: "other", message: "Messaggio di prova lungo" })).s === 401);
check("support: cross-origin -> 403", (await user.call("POST", "/api/support", { subject: "Ciao", category: "other", message: "Messaggio di prova" }, { origin: "https://evil.example" })).s === 403);
const bad = async (b, code) => { const r = await user.call("POST", "/api/support", b); return r.s === 400 && r.j.code === code; };
check("support: subject too short -> 400", await bad({ subject: "a", category: "other", message: "Messaggio di prova" }, "invalid_subject"));
check("support: subject too long -> 400", await bad({ subject: "x".repeat(121), category: "other", message: "Messaggio di prova" }, "invalid_subject"));
check("support: bad category -> 400", await bad({ subject: "Ciao", category: "hack", message: "Messaggio di prova" }, "invalid_category"));
check("support: message too short -> 400", await bad({ subject: "Ciao", category: "other", message: "corto" }, "invalid_message"));
check("support: message too long -> 400", await bad({ subject: "Ciao", category: "other", message: "x".repeat(4001) }, "invalid_message"));
check("support: javascript: link -> 400", await bad({ subject: "Ciao", category: "other", message: "Messaggio di prova", link: "javascript:alert(1)" }, "invalid_link"));
fs.writeFileSync(MAILS, "");
const evil = "<script>alert(1)</script> & <b>x</b>";
const sp = await user.call("POST", "/api/support", { subject: "Pagamento " + tag, category: "payment", message: "Ho un problema: " + evil, link: "https://dreamint.it/#/carta/x" });
check("support: valid -> 201 open", sp.s === 201 && sp.j.request.status === "open", sp.s + " " + String(sp.t).slice(0, 120));
await sleep(1500);
const sm = fs.readFileSync(MAILS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).flatMap((m) => Array.isArray(m.body) ? m.body : [m.body]).filter((e) => /assistenza/i.test(e.subject || ""));
const sto = sm.flatMap((e) => e.to.map((x) => x.toLowerCase()));
check("support mail to every admin + NOTIFY_EMAIL, deduped", sto.includes(admin.email) && sto.includes(admin2.email) && sto.includes(NOTIFY_TO) && sto.length === new Set(sto).size && !sto.includes(fakeLocal), sto.length);
check("support mail reply_to = user email", sm.length > 0 && sm.every((e) => e.reply_to === user.email));
check("support mail HTML escaped (no raw <script>/<b>)", sm.every((e) => !e.html.includes("<script>") && !e.html.includes("<b>x</b>") && e.html.includes("&lt;script&gt;")));
check("support row stored", d1(`SELECT COUNT(*) n FROM support_requests WHERE id='${sp.j.request.id}' AND category='payment' AND status='open'`)[0].n === 1);
check("support admin list: user -> 403, anon -> 401", (await user.call("GET", "/api/admin/support")).s === 403 && (await anon.call("GET", "/api/admin/support")).s === 401);
const al = await admin.call("GET", "/api/admin/support?status=open");
check("support admin list shows open request", al.s === 200 && al.j.requests.some((r) => r.id === sp.j.request.id && r.category_label === "Pagamento"));
check("support PATCH: user -> 403", (await user.call("PATCH", `/api/admin/support/${sp.j.request.id}`, { status: "closed" })).s === 403);
check("support PATCH bad status -> 400", (await admin.call("PATCH", `/api/admin/support/${sp.j.request.id}`, { status: "x" })).s === 400);
const cl = await admin.call("PATCH", `/api/admin/support/${sp.j.request.id}`, { status: "closed" });
const row = d1(`SELECT status, closed_at, closed_by FROM support_requests WHERE id='${sp.j.request.id}'`)[0];
check("support close -> closed_at/closed_by set", cl.s === 200 && row.status === "closed" && row.closed_at && row.closed_by === uid(admin));
check("closed list contains it, open list not", (await admin.call("GET", "/api/admin/support?status=closed")).j.requests.some((r) => r.id === sp.j.request.id) && !(await admin.call("GET", "/api/admin/support")).j.requests.some((r) => r.id === sp.j.request.id));
const ro = await admin.call("PATCH", `/api/admin/support/${sp.j.request.id}`, { status: "open" });
check("support reopen -> open, closed_* cleared", ro.s === 200 && d1(`SELECT closed_at FROM support_requests WHERE id='${sp.j.request.id}'`)[0].closed_at === null);
check("support PATCH unknown -> 404", (await admin.call("PATCH", `/api/admin/support/nope`, { status: "closed" })).s === 404);
check("support audit rows", d1(`SELECT COUNT(*) n FROM audit_logs WHERE entity_id='${sp.j.request.id}'`)[0].n === 3);
d1("DELETE FROM rate_limits WHERE key LIKE 'ip-support%'");
const ok2 = await user.call("POST", "/api/support", { subject: "Due " + tag, category: "technical", message: "Secondo messaggio di prova" });
const ok3 = await user.call("POST", "/api/support", { subject: "Tre " + tag, category: "other", message: "Terzo messaggio di prova" });
const r4 = await user.call("POST", "/api/support", { subject: "Quattro " + tag, category: "other", message: "Quarto messaggio di prova" });
check("support per-user limit: 3/h then 429", ok2.s === 201 && ok3.s === 201 && r4.s === 429, [ok2.s, ok3.s, r4.s].join(","));
let ipLast; const extra = client();
for (let i = 0; i < 12; i++) { ipLast = await extra.call("POST", "/api/support", {}); if (ipLast.s === 429) break; }
check("support per-IP limit 10/h -> 429", ipLast.s === 429, ipLast.s);
d1("DELETE FROM rate_limits");

// ---------- 4. dedup POST /api/cards ----------
const before = Number(d1(`SELECT COUNT(*) n FROM slabs WHERE submitter_id='${uid(user)}'`)[0].n);
const body = raw(7, { photos: { front: fx.PNG, back: fx.JPEG } });
const burst = await Promise.all([1, 2, 3, 4, 5].map(() => user.call("POST", "/api/cards", body)));
const ids = new Set(burst.map((r) => r.j && r.j.card && r.j.card.id));
check("5 concurrent identical submits -> 1 slab", Number(d1(`SELECT COUNT(*) n FROM slabs WHERE submitter_id='${uid(user)}'`)[0].n) === before + 1, burst.map((r) => r.s).join(","));
check("all 5 answers point to the same request (201 once, 200 dedup otherwise)", ids.size === 1 && burst.filter((r) => r.s === 201).length === 1 && burst.filter((r) => r.s === 200 && r.j.dedup === true).length === 4, burst.map((r) => r.s).join(","));
const again = await user.call("POST", "/api/cards", body);
check("sequential resend -> 200 dedup:true same card", again.s === 200 && again.j.dedup === true && ids.has(again.j.card.id));
const diffPhoto = await user.call("POST", "/api/cards", raw(7, { photos: { front: fx.JPEG, back: fx.JPEG } }));
check("same card, different front photo -> new request (2 real copies)", diffPhoto.s === 201 && !ids.has(diffPhoto.j.card.id));
const diffCond = await user.call("POST", "/api/cards", { ...body, condition: "EX" });
check("different condition -> new request", diffCond.s === 201);
const otherUser = await buyer.call("POST", "/api/cards", body);
check("same body by another user -> new request", otherUser.s === 201);
const firstId = [...ids][0];
d1(`UPDATE slabs SET created_at='2026-01-01T00:00:00.000Z' WHERE id='${firstId}'`);
const late = await user.call("POST", "/api/cards", body);
check("after 5 minutes -> new request", late.s === 201 && late.j.card.id !== firstId);
await admin.call("POST", "/api/admin/cards/" + late.j.card.id + "/approve", {});
const afterApprove = await user.call("POST", "/api/cards", body);
check("once approved (not in review) -> new request allowed", afterApprove.s === 201);

// ---------- 5. notifications to every admin ----------
fs.writeFileSync(MAILS, "");
const nt = await user.call("POST", "/api/cards", raw(9));
await sleep(1500);
const mails = fs.readFileSync(MAILS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const verify = mails.filter((m) => m.path.startsWith("/emails"));
const sent = verify.flatMap((m) => Array.isArray(m.body) ? m.body : [m.body]).filter((e) => /nuova richiesta di verifica/.test(e.subject || ""));
const to = sent.flatMap((e) => e.to.map((x) => x.toLowerCase()));
check("new card -> 201", nt.s === 201, nt.s);
check("verification mail to every admin (incl. no-username admin)", to.includes(admin.email) && to.includes(admin2.email), JSON.stringify(to.map((x) => x.replace(/@.*/, "@…"))));
check("NOTIFY_EMAIL still included", to.includes(NOTIFY_TO));
check("deduplicated: each address once", to.length === new Set(to).size, to.length);
check("one email per recipient (admins don't see each other)", sent.every((e) => e.to.length === 1));
check(".local admin address skipped", !to.includes(fakeLocal));
check("Resend: single batch call", verify.filter((m) => m.path === "/emails/batch").length === 1, verify.map((m) => m.path).join(","));
d1(`DELETE FROM users WHERE id='t23-local-${tag}'`);
console.log(out.join("\n"));
console.log(fail ? `\n${fail} FAILED` : `\nALL ${out.length} PASSED`);
process.exit(fail ? 1 : 0);
