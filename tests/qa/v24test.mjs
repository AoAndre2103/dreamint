// Local test v24: username mandatory at signup, needs_username flag, live availability check.
import { execSync } from "child_process";
const B = process.env.B || "http://localhost:8977";
const QADB = process.env.QADB || ".qa-tmp/db";
const pw = "Passw0rd-local-qa";
const d1 = (sql) => JSON.parse(execSync(`cd . && npx wrangler d1 execute gemint-beta --local --persist-to ${QADB} --json --command "${sql}"`, { stdio: ["ignore", "pipe", "ignore"] }).toString())[0].results;
function client() {
  const c = { cookie: "" };
  c.call = async (method, path, body, headers = {}) => {
    const r = await fetch(B + path, { method, redirect: "manual", headers: { "content-type": "application/json", origin: B, cookie: c.cookie, ...headers }, body: body == null ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) c.cookie = sc.split(";")[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t.slice(0, 200); }
    return { s: r.status, j, t, h: r.headers };
  };
  return c;
}
const out = []; let fail = 0;
const check = (n, ok, info = "") => { out.push((ok ? "PASS " : "FAIL ") + n + (info !== "" ? "  [" + info + "]" : "")); if (!ok) fail++; };
d1("DELETE FROM rate_limits");
const ts = Date.now(), tag = ts.toString(36).slice(-5);
const anon = client(), a = client(), legacy = client(), x = client();
const r0 = await x.call("POST", "/api/auth/signup", { email: `t24nou-${ts}@example.com`, password: pw, display_name: `V24 nouser ${tag}`, plan: "free" });
check("signup without username -> 400 username_invalid, no account", r0.s === 400 && r0.j.code === "username_invalid" && d1(`SELECT COUNT(*) n FROM users WHERE email='t24nou-${ts}@example.com'`)[0].n === 0, r0.s);
const r1 = await a.call("POST", "/api/auth/signup", { email: `t24a-${ts}@example.com`, password: pw, display_name: `V24 alpha ${tag}`, username: `prof.oak${tag}`, plan: "free" });
check("signup with dotted username -> 201, needs_username false", r1.s === 201 && r1.j.user.username === `prof.oak${tag}` && r1.j.user.needs_username === false, r1.s);
await legacy.call("POST", "/api/auth/signup", { email: `t24leg-${ts}@example.com`, password: pw, display_name: `V24 legacy ${tag}`, username: `t24leg_${tag}`, plan: "free" });
d1(`UPDATE users SET username=NULL WHERE email='t24leg-${ts}@example.com'`);
const me0 = await legacy.call("GET", "/api/me");
check("legacy user without username: /api/me needs_username true", me0.j.user.needs_username === true && me0.j.user.username === null);
check("anon /api/me: user null", (await anon.call("GET", "/api/me")).j.user === null);
const av = (c, u) => c.call("GET", "/api/users/username-available?u=" + encodeURIComponent(u));
const i1 = await av(anon, "a!");
check("availability: invalid -> available false username_invalid", i1.s === 200 && i1.j.available === false && i1.j.code === "username_invalid");
check("availability: reserved 'admin' -> invalid", (await av(anon, "admin")).j.available === false);
const tk = await av(legacy, `PROF.OAK${tag}`);
check("availability: taken (case-insensitive) -> username_taken", tk.j.available === false && tk.j.code === "username_taken", JSON.stringify(tk.j));
const fr = await av(legacy, `naso${tag}`);
check("availability: free -> available true, normalized lower-case", fr.j.available === true && fr.j.username === `naso${tag}`);
check("availability: own current username -> available (current)", (await av(a, `prof.oak${tag}`)).j.current === true);
check("availability: no-store, no ids/emails", fr.h.get("cache-control") === "no-store" && !/@|"id"/.test(fr.t));
const taken = await legacy.call("PATCH", "/api/me", { username: `prof.oak${tag}`, plan: "free" });
check("PATCH me with taken username -> 409", taken.s === 409 && taken.j.code === "username_taken");
const set = await legacy.call("PATCH", "/api/me", { username: `naso${tag}` });
check("PATCH me username -> 200, needs_username false", set.s === 200 && set.j.user.username === `naso${tag}` && set.j.user.needs_username === false, set.s);
check("/api/me after: needs_username false", (await legacy.call("GET", "/api/me")).j.user.needs_username === false);
const s1 = await anon.call("GET", `/api/users/search?q=naso${tag}`);
check("anon search finds the new username (private profile)", s1.j.users.some((u) => u.username === `naso${tag}` && u.private === true));
const s2 = await anon.call("GET", `/api/users/search?q=prof.oak${tag}`);
check("anon search with dot finds prof.oak…", s2.j.users.some((u) => u.username === `prof.oak${tag}`));
let last; for (let i = 0; i < 64; i++) { last = await av(anon, "zz" + i + "x"); if (last.s === 429) break; }
check("availability rate limit 60/min -> 429", last.s === 429 && !!last.h.get("retry-after"), last.s);
d1("DELETE FROM rate_limits");
console.log(out.join("\n"));
console.log(fail ? `\n${fail} FAILED` : `\nALL ${out.length} PASSED`);
process.exit(fail ? 1 : 0);
