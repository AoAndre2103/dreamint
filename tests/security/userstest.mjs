// Local test: usernames at signup / PATCH /api/me, user search, public albums (migrate-v16.sql).
import fs from "fs";
import { execSync } from "child_process";
const B = process.env.B || (process.env.B || "http://localhost:8977");
const fx = JSON.parse(fs.readFileSync(new URL("./fixtures.json", import.meta.url)));
const pw = "Passw0rd-local-qa";
const d1 = (sql) => JSON.parse(execSync(`cd /workspace/gemint-beta && WRANGLER_CACHE_DIR=/workspace/cf/.cache npx wrangler d1 execute gemint-beta --local --persist-to ${process.env.QADB || "/workspace/tmp-qa/db"} --json --command "${sql}"`, { stdio: ["ignore", "pipe", "ignore"] }).toString())[0].results;
function client() {
  const c = { cookie: "" };
  c.call = async (method, path, body, headers = {}) => {
    const r = await fetch(B + path, { method, headers: { "content-type": "application/json", origin: B, cookie: c.cookie, ...headers }, body: body == null ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) c.cookie = sc.split(";")[0];
    if (r.status === 201 && method === "POST" && path === "/api/cards/challenge") {
      const j0 = await r.clone().json();
      await fetch(B + "/api/cards/challenge/" + j0.challenge_id + "/video", { method: "POST", headers: { "content-type": "video/mp4", origin: B, cookie: c.cookie }, body: fs.readFileSync("/workspace/gemint-beta/tests/fixtures-video/ok-h264.mp4") });
    }
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t.slice(0, 80); }
    return { s: r.status, j, h: r.headers, t };
  };
  return c;
}
const out = []; let fail = 0;
const check = (n, ok, info = "") => { out.push((ok ? "PASS " : "FAIL ") + n + (info !== "" ? "  [" + info + "]" : "")); if (!ok) fail++; };
d1("DELETE FROM rate_limits");
const ts = Date.now(), tag = ts.toString(36).slice(-5);
let nSign = 0;
const signup = (c, n, extra = {}) => { if (!c.noReset) d1("DELETE FROM rate_limits"); c.email = `${n}-${ts}@example.com`; return c.call("POST", "/api/auth/signup", { email: c.email, password: pw, display_name: "Nome " + n, ...extra }); };
const userCount = (email) => d1(`SELECT COUNT(*) n FROM users WHERE email='${email}'`)[0].n;

// --- signup
const s0 = client(); const r0 = await signup(s0, "nouser");
check("signup without username -> 400 username_invalid, no account", r0.s === 400 && r0.j.code === "username_invalid" && userCount(s0.email) === 0, r0.s);
for (const bad of ["ab", "a".repeat(21), "bad-name", "spazio x", "ciaò", "admin", "Admin", "administrator2", "dreamint_it", "xx.dreamint", "support", "api", "search", 42]) {
  const c = client(); const r = await signup(c, "bad" + Math.random().toString(36).slice(2, 7), { username: bad });
  check(`signup username ${JSON.stringify(bad)} -> 400 username_invalid`, r.s === 400 && r.j.code === "username_invalid" && userCount(c.email) === 0, r.s);
}
const A = client(); const ra = await signup(A, "alice", { username: `Alice.${tag}_1` });
check("signup with username -> 201, saved lower-case, album private by default", ra.s === 201 && ra.j.user.username === `alice.${tag}_1` && ra.j.user.album_public === false, JSON.stringify(ra.j.user && [ra.j.user.username, ra.j.user.album_public]));
const me = (await A.call("GET", "/api/me")).j.user;
check("GET /api/me has username + album_public", me.username === `alice.${tag}_1` && me.album_public === false);
const D = client(); const rd = await signup(D, "dup", { username: `ALICE.${tag}_1` });
check("signup duplicate username (different case) -> 409 username_taken, no account", rd.s === 409 && rd.j.code === "username_taken" && userCount(D.email) === 0, rd.s);
const P = client(); const rp = await signup(P, "pub", { username: `pubby_${tag}`, album_public: true });
check("signup album_public:true -> 201 album_public true", rp.s === 201 && rp.j.user.album_public === true);
const X = client(); const rx = await signup(X, "badalbum", { username: `badalb_${tag}`, album_public: "yes" });
check("signup album_public non-bool -> 400", rx.s === 400 && userCount(X.email) === 0);
// race: same username, 6 parallel signups
d1("DELETE FROM rate_limits"); nSign = 1;
const racers = Array.from({ length: 6 }, () => Object.assign(client(), { noReset: true }));
const rr = await Promise.all(racers.map((c, i) => signup(c, "race" + i, { username: `race_${tag}` })));
const st = rr.map((r) => r.s).sort();
const raceUsers = d1(`SELECT COUNT(*) n FROM users WHERE lower(username)='race_${tag}'`)[0].n;
const orphan = racers.filter((c, i) => rr[i].s !== 201 && userCount(c.email) !== 0).length;
check("race: exactly one 201, the rest 409 username_taken, one row, no half accounts", st.filter((s) => s === 201).length === 1 && rr.every((r) => r.s === 201 || (r.s === 409 && r.j.code === "username_taken")) && raceUsers === 1 && orphan === 0, st.join(","));

// --- PATCH /api/me
const L = client(); await signup(L, "legacy", { username: `legacy_${tag}` });
d1(`UPDATE users SET username=NULL WHERE email='${L.email}'`); // simulate an existing (pre-v16) account, local DB only
check("legacy user: /api/me username null, album private", (await L.call("GET", "/api/me")).j.user.username === null);
const u1 = await L.call("PATCH", "/api/me", { album_public: true });
check("album_public:true without username -> 400 username_required", u1.s === 400 && u1.j.code === "username_required");
check("PATCH invalid username -> 400 username_invalid", (await L.call("PATCH", "/api/me", { username: "x!" })).j.code === "username_invalid");
check("PATCH reserved username -> 400", (await L.call("PATCH", "/api/me", { username: "Support" })).s === 400);
const u2 = await L.call("PATCH", "/api/me", { username: `ALICE.${tag}_1` });
check("PATCH someone else's username (case) -> 409 username_taken", u2.s === 409 && u2.j.code === "username_taken");
await L.call("PATCH", "/api/me", { paypal_email: `pp-${ts}@example.com` });
const u3 = await L.call("PATCH", "/api/me", { username: `Leg.${tag}` });
check("PATCH valid username -> 200, lower-case, paypal_email untouched", u3.s === 200 && u3.j.user.username === `leg.${tag}` && u3.j.user.paypal_email === `pp-${ts}@example.com`, JSON.stringify(u3.j.user && [u3.j.user.username, !!u3.j.user.paypal_email]));
check("PATCH same username again -> 200", (await L.call("PATCH", "/api/me", { username: `leg.${tag}` })).s === 200);
const u4 = await L.call("PATCH", "/api/me", { album_public: true });
check("PATCH album_public:true with username -> 200 (no verified email needed)", u4.s === 200 && u4.j.user.album_public === true && u4.j.user.email_verified === false);
check("PATCH album_public non-bool -> 400", (await L.call("PATCH", "/api/me", { album_public: 1 })).s === 400);
check("PATCH cross-origin -> 403", (await L.call("PATCH", "/api/me", { album_public: false }, { origin: "https://evil.example" })).s === 403);
check("PATCH guest -> 401", (await client().call("PATCH", "/api/me", { username: "guest_x" })).s === 401);
const prr = await Promise.all([L, A].map((c) => c.call("PATCH", "/api/me", { username: `swap_${tag}` })));
check("PATCH race on the same username: one 200, one 409", prr.map((r) => r.s).sort().join(",") === "200,409", prr.map((r) => r.s).join(","));
const lname = (await L.call("GET", "/api/me")).j.user.username, aname = (await A.call("GET", "/api/me")).j.user.username;

// --- cards for the public album of P
const admin = client(); await signup(admin, "uadmin", { username: `uadm_${tag}` });
d1(`UPDATE users SET role='admin', email_verified_at='2026-11-12T00:00:00.000Z' WHERE email IN ('${admin.email}','${P.email}')`);
await P.call("PATCH", "/api/me", { paypal_email: `pay-${ts}@example.com` });
const raw = (n, price) => ({ game: "pokemon", set_name: "Album QA", code: n + "/99", name: "Album " + n, language: "ITA", variant: "normal", is_ungraded: true, grader: "NONE", condition: "NM", photos: { front: fx.JPEG, back: fx.JPEG }, ...(price ? { price_euros: price } : {}) });
const c1 = (await P.call("POST", "/api/cards", raw(1))).j.card.id;          // approved, album only
const c2 = (await P.call("POST", "/api/cards", raw(2, "12,50"))).j.card.id; // approved + auto-listed
const c3 = (await P.call("POST", "/api/cards", raw(3))).j.card.id;          // stays in_review
const c4 = (await P.call("POST", "/api/cards", raw(4))).j.card.id;          // archived
await P.call("POST", "/api/cards/challenge", {});
const ch = (await P.call("POST", "/api/cards/challenge", {})).j;
const g = await P.call("POST", "/api/cards", { game: "pokemon", set_name: "Album QA", code: "5/99", name: "Album graded", language: "ITA", variant: "normal", is_ungraded: false, grader: "PSA", certificate_no: "ALB" + ts, grade: "10", photos: { front: fx.JPEG }, challenge_id: ch.challenge_id });
for (const id of [c1, c2, c4, g.j.card && g.j.card.id]) await admin.call("POST", `/api/admin/cards/${id}/approve`, {});
await P.call("POST", `/api/cards/${c4}/archive`, { reason: "sold_outside" });
const alb = await client().call("GET", `/api/users/${encodeURIComponent(`PUBBY_${tag}`)}/album`);
const ids = alb.s === 200 ? alb.j.cards.map((c) => c.id) : [];
check("album (case-insensitive) -> 200 {username, cards_count, cards}", alb.s === 200 && alb.j.username === `pubby_${tag}` && Object.keys(alb.j).sort().join() === "cards,cards_count,username", alb.s);
check("album: approved cards in, in_review and archived out", ids.includes(c1) && ids.includes(c2) && !ids.includes(c3) && !ids.includes(c4) && alb.j.cards_count === ids.length, JSON.stringify([ids.length, alb.j.cards_count]));
const card2 = alb.j.cards.find((c) => c.id === c2), card1 = alb.j.cards.find((c) => c.id === c1), cg = alb.j.cards.find((c) => c.id === (g.j.card && g.j.card.id));
check("listed card: in_vendita true + price 1250; album-only card: false/null", card2 && card2.in_vendita === true && card2.price_cents === 1250 && card1.in_vendita === false && card1.price_cents === null, JSON.stringify(card2));
check("ungraded card: no rarity/serial/grade, type ungraded", card1.type === "ungraded" && card1.rarity_tier === null && card1.serial_number === null && card1.grade === null);
check("graded card (unopened): type graded, grade shown, rarity/serial/public_url hidden", cg && cg.type === "graded" && cg.grade === "10" && cg.rarity_tier === null && cg.serial_number === null && cg.public_url === null, JSON.stringify(cg));
check("photo URLs served publicly (guest 200 image)", (await fetch(B + card1.front_url)).status === 200 && (await fetch(B + card1.back_url)).status === 200);
const body = alb.t, uids = d1("SELECT id, email, country, display_name FROM users");
const leak = uids.filter((u) => body.includes(u.id) || body.includes(u.email) || (String(u.display_name).length > 3 && body.includes(JSON.stringify(u.display_name))));
check("album JSON: no user UUID / email / display_name", !leak.length, leak.map((u) => u.display_name).join("|"));
check("album JSON: no sensitive keys", !/digital_owner|physical_owner|assigned_at|country|city|email|display_name|seller_id|_id"/.test(body), (body.match(/"[a-z_]*_id"/g) || []).join());
// privacy / IDOR: private album, unknown user, null username are indistinguishable
const priv = await client().call("GET", `/api/users/${aname}/album`);
const none = await client().call("GET", `/api/users/nobody_${tag}x/album`);
const weird = await client().call("GET", `/api/users/%25/album`);
// v23 (Andrea 13/11): private profiles are visible, but their cards are not (only owner + admin).
check("private album -> 200 private:true, no cards, no count", priv.s === 200 && priv.j.private === true && Array.isArray(priv.j.cards) && priv.j.cards.length === 0 && priv.j.cards_count === null, priv.s + " " + String(priv.t).slice(0, 120));
check("unknown / invalid -> identical 404 bodies", none.s === 404 && weird.s === 404 && none.t === weird.t && none.j.code === "not_found");
const ownPriv = await A.call("GET", `/api/users/${aname}/album`);
check("owner's own private album -> 200 with own cards list", ownPriv.s === 200 && ownPriv.j.private === true && ownPriv.j.owner_view === true && Array.isArray(ownPriv.j.cards));
await P.call("PATCH", "/api/me", { album_public: false });
const turned = await client().call("GET", `/api/users/pubby_${tag}/album`);
check("album turned private -> cards hidden immediately", turned.s === 200 && turned.j.private === true && turned.j.cards.length === 0);
await P.call("PATCH", "/api/me", { album_public: true });

// --- search
check("/api/config public_albums: true", (await client().call("GET", "/api/config")).j.public_albums === true);
check("album card has front_url/back_url, in_vendita + on_sale alias", card2.front_url === "/api/cards/" + c2 + "/photo/front" && card2.back_url && card2.on_sale === true);
check("search q too short -> 400 query_too_short", (await client().call("GET", "/api/users/search?q=a")).j.code === "query_too_short");
check("search q 31 chars -> 400", (await client().call("GET", "/api/users/search?q=" + "a".repeat(31))).s === 400);
check("search q missing -> 400", (await client().call("GET", "/api/users/search")).s === 400);
const s1 = await client().call("GET", `/api/users/search?q=PUBBY_${tag}`);
check("search prefix (case-insensitive) finds public user with cards_count", s1.s === 200 && s1.j.users.length === 1 && s1.j.users[0].username === `pubby_${tag}` && s1.j.users[0].cards_count === ids.length, JSON.stringify(s1.j));
check("search result keys only username + cards_count + private", s1.j.users.every((u) => Object.keys(u).sort().join() === "cards_count,private,username"));
const sp = await client().call("GET", `/api/users/search?q=${aname}`);
check("search: private profile found, private:true, no card count", sp.j.users.length === 1 && sp.j.users[0].private === true && sp.j.users[0].cards_count === null, JSON.stringify(sp.j));
const s2 = await client().call("GET", `/api/users/search?q=${tag}`);
check("search contains fallback (tag in the middle) returns matching profiles, private flagged", s2.s === 200 && s2.j.users.some((u) => u.username === `pubby_${tag}`) && s2.j.users.every((u) => u.username.includes(tag) && (u.private ? u.cards_count === null : true)), JSON.stringify(s2.j.users.map((u) => u.username)));
check("search: '%%' and '__' are literal (no wildcard dump)", (await client().call("GET", "/api/users/search?q=%25%25")).j.users.length === 0 && (await client().call("GET", "/api/users/search?q=__")).j.users.every((u) => u.username.includes("__")));
check("search: at most 20 results", (await client().call("GET", "/api/users/search?q=qa")).j.users.length <= 20);
check("search result has no email/id", !/@|"id"/.test(s1.t));
// rate limits (per IP)
let last; for (let i = 0; i < 62; i++) { last = await client().call("GET", "/api/users/search?q=zz"); if (last.s === 429) break; }
check("search rate limit 30/min -> 429 + Retry-After", last.s === 429 && !!last.h.get("retry-after"), last.s);
let la; for (let i = 0; i < 122; i++) { la = await client().call("GET", `/api/users/nobody_${tag}/album`); if (la.s === 429) break; }
check("album rate limit -> 429 + Retry-After", la.s === 429 && !!la.h.get("retry-after"), la.s);
d1("DELETE FROM rate_limits");
console.log(out.join("\n")); console.log(fail ? `\n${fail} FAILED` : `\nALL ${out.length} PASSED`); process.exit(fail ? 1 : 0);
