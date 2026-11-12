// Fixed-window rate limits stored in D1 (table rate_limits, migrate-v12.sql).
// Fail-open on storage errors so a DB hiccup never blocks normal use.

const MIN = 60;
const HOUR = 3600;

// Per-IP rules by method + API path (path without the /api/ prefix).
export const IP_RULES = [
  { name: "login", test: (m, p) => m === "POST" && p === "auth/login", limit: 30, windowSec: 10 * MIN },
  { name: "signup", test: (m, p) => m === "POST" && p === "auth/signup", limit: 6, windowSec: HOUR },
  { name: "upload", test: (m, p) => m === "POST" && (p === "cards" || /^cards\/[^/]+\/photos$/.test(p)), limit: 60, windowSec: HOUR },
  { name: "catalog", test: (m, p) => m === "POST" && p === "catalog", limit: 120, windowSec: HOUR },
  { name: "buy", test: (m, p) => m === "POST" && /^listings\/[^/]+\/request$/.test(p), limit: 30, windowSec: HOUR },
  { name: "sale", test: (m, p) => m === "POST" && /^sales\//.test(p), limit: 120, windowSec: HOUR },
  { name: "me", test: (m, p) => m === "PATCH" && p === "me", limit: 20, windowSec: HOUR },
  { name: "copy", test: (m, p) => m === "POST" && (p === "copies/redeem" || p === "claims" || /^cards\/[^/]+\/transfer-code$/.test(p)), limit: 20, windowSec: HOUR },
  { name: "certcode", test: (m, p) => m === "GET" && /^cards\/[^/]+\/certificate$/.test(p), limit: 120, windowSec: HOUR },
  { name: "verifymail", test: (m, p) => m === "POST" && p === "auth/resend-verification", limit: 10, windowSec: HOUR },
  { name: "verifylink", test: (m, p) => m === "GET" && p === "auth/verify-email", limit: 60, windowSec: HOUR },
  { name: "challenge", test: (m, p) => m === "POST" && p === "cards/challenge", limit: 60, windowSec: HOUR },
  { name: "challengevideo", test: (m, p) => m === "POST" && /^cards\/challenge\/[^/]+\/video$/.test(p), limit: 20, windowSec: HOUR },
  { name: "archive", test: (m, p) => m === "POST" && /^cards\/[^/]+\/archive$/.test(p), limit: 30, windowSec: HOUR },
  { name: "usersearch", test: (m, p) => m === "GET" && p === "users/search", limit: 30, windowSec: MIN },
  { name: "useralbum", test: (m, p) => m === "GET" && /^users\/[^/]+\/album$/.test(p), limit: 60, windowSec: MIN },
  { name: "certsearch", test: (m, p) => m === "GET" && p === "search/cert", limit: 30, windowSec: MIN },
  { name: "market", test: (m, p) => m === "PATCH" && /^cards\/[^/]+\/market$/.test(p), limit: 60, windowSec: HOUR },
  { name: "socialstamp", test: (m, p) => m === "GET" && /^copies\/[^/]+\/social-stamp$/.test(p), limit: 60, windowSec: MIN },
  { name: "paypal", test: (m, p) => m === "POST" && (p === "paypal/ipn" || p === "paypal/webhook"), limit: 120, windowSec: MIN }
];

// Failed logins: per email+IP (stops brute force) and per email (slow distributed attacks).
export const LOGIN_FAIL_RULES = [
  { name: "loginfail-ip", limit: 5, windowSec: 15 * MIN },
  { name: "loginfail-email", limit: 30, windowSec: HOUR }
];

// IPv6 clients are grouped by /64 (one subscriber usually owns a whole /64).
export function clientIp(request) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "0.0.0.0";
  if (ip.includes(":")) {
    const parts = ip.split("::")[0].split(":");
    return parts.slice(0, 4).join(":") + "::/64";
  }
  return ip;
}

function rlError(retryAfter) {
  return Object.assign(new Error("Troppe richieste: riprova tra " + Math.max(1, Math.ceil(retryAfter / 60)) + " min"), {
    status: 429,
    retryAfter: Math.max(1, Math.ceil(retryAfter))
  });
}

function windowFor(windowSec, nowSec) {
  const idx = Math.floor(nowSec / windowSec);
  return { idx, resetAt: (idx + 1) * windowSec };
}

// Increments the counter and returns { count, retryAfter }.
export async function hit(env, bucket, ident, rule, nowSec) {
  const now = nowSec != null ? nowSec : Math.floor(Date.now() / 1000);
  const w = windowFor(rule.windowSec, now);
  const key = bucket + ":" + ident + ":" + w.idx;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET count = count + 1
     RETURNING count`
  ).bind(key, w.resetAt).first();
  if (Math.random() < 0.02) {
    try { await env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(now).run(); } catch (e) { /* ignore */ }
  }
  return { count: Number(row && row.count) || 1, retryAfter: w.resetAt - now };
}

export async function peek(env, bucket, ident, rule, nowSec) {
  const now = nowSec != null ? nowSec : Math.floor(Date.now() / 1000);
  const w = windowFor(rule.windowSec, now);
  const row = await env.DB.prepare("SELECT count FROM rate_limits WHERE key = ?")
    .bind(bucket + ":" + ident + ":" + w.idx).first();
  return { count: Number(row && row.count) || 0, retryAfter: w.resetAt - now };
}

// Throws a 429 error (with retryAfter) when the per-IP rule for this route is exceeded.
export async function enforceIpRule(env, request, method, path) {
  const rule = IP_RULES.find((r) => r.test(method, path));
  if (!rule || !env || !env.DB) return;
  let r;
  try {
    r = await hit(env, "ip-" + rule.name, clientIp(request), rule);
  } catch (e) {
    console.log("rate limit skipped", e && e.message);
    return;
  }
  if (r.count > rule.limit) throw rlError(r.retryAfter);
}

function emailIdent(email) {
  return String(email || "").trim().toLowerCase().slice(0, 200);
}

// Before checking the password: refuse if this email already has too many failures.
export async function assertLoginAllowed(env, request, email) {
  const e = emailIdent(email);
  if (!e) return;
  try {
    const a = await peek(env, LOGIN_FAIL_RULES[0].name, e + "|" + clientIp(request), LOGIN_FAIL_RULES[0]);
    if (a.count >= LOGIN_FAIL_RULES[0].limit) throw rlError(a.retryAfter);
    const b = await peek(env, LOGIN_FAIL_RULES[1].name, e, LOGIN_FAIL_RULES[1]);
    if (b.count >= LOGIN_FAIL_RULES[1].limit) throw rlError(b.retryAfter);
  } catch (err) {
    if (err && err.status === 429) throw err;
    console.log("login rate limit skipped", err && err.message);
  }
}

export async function recordLoginFailure(env, request, email) {
  const e = emailIdent(email);
  if (!e) return;
  try {
    await hit(env, LOGIN_FAIL_RULES[0].name, e + "|" + clientIp(request), LOGIN_FAIL_RULES[0]);
    await hit(env, LOGIN_FAIL_RULES[1].name, e, LOGIN_FAIL_RULES[1]);
  } catch (err) {
    console.log("login rate limit skipped", err && err.message);
  }
}

// Per-identity limit (e.g. per user id). Throws 429 with retryAfter; fail-open on storage errors.
export async function enforceIdentRule(env, rule, ident) {
  if (!env || !env.DB || !ident) return;
  let r;
  try {
    r = await hit(env, rule.name, String(ident), rule);
  } catch (e) {
    console.log("rate limit skipped", e && e.message);
    return;
  }
  if (r.count > rule.limit) throw rlError(r.retryAfter);
}
