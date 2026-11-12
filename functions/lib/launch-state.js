/**
 * Server-side launch state machine for DreaMint.
 * States: BETA -> LAUNCH_PROMO -> PROMO_ENDED -> MONETIZATION_ENABLED.
 * - Default (no row / no table): BETA.
 * - Times always come from the server clock, never from the browser.
 * - Only admins can change state; every change needs an explicit confirmation
 *   phrase and is written to launch_state_log (who / when / from / to).
 * - No commission is charged anywhere by this module: it only exposes state.
 */

export const LAUNCH_STATES = ["BETA", "LAUNCH_PROMO", "PROMO_ENDED", "MONETIZATION_ENABLED"];
export const CONFIRM_PHRASE = "CONFERMO";
const KEY = "launch_state";

// Allowed manual transitions. Going back to BETA is allowed as a safety valve (logged).
const TRANSITIONS = {
  BETA: ["LAUNCH_PROMO"],
  LAUNCH_PROMO: ["PROMO_ENDED", "BETA"],
  PROMO_ENDED: ["MONETIZATION_ENABLED", "BETA"],
  MONETIZATION_ENABLED: ["PROMO_ENDED"]
};

export function allowedTransitions(state) {
  return (TRANSITIONS[state] || []).slice();
}

export function promoDays(env) {
  const n = Number(env && env.OFFER_DAYS);
  return Number.isFinite(n) && n > 0 && n <= 60 ? Math.floor(n) : 15;
}

function parseStored(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || !LAUNCH_STATES.includes(o.state)) return null;
    return o;
  } catch (e) {
    return null;
  }
}

/** Pure: compute the public view of a stored record at server time `now` (ms). */
export function presentLaunch(stored, now, days) {
  const rec = stored || { state: "BETA" };
  const state = LAUNCH_STATES.includes(rec.state) ? rec.state : "BETA";
  const out = {
    state,
    effective_state: state,
    promo_days: days || 15,
    promo_start: rec.promo_start || null,
    promo_end: rec.promo_end || null,
    server_now: new Date(now).toISOString(),
    remaining_ms: null,
    commissions_active: false,
    updated_at: rec.updated_at || null
  };
  if (state === "LAUNCH_PROMO" && rec.promo_end) {
    const end = Date.parse(rec.promo_end);
    if (Number.isFinite(end)) {
      out.remaining_ms = Math.max(0, end - now);
      // Once the promo window is over, the public view is PROMO_ENDED even before an admin moves it.
      if (end <= now) { out.effective_state = "PROMO_ENDED"; out.remaining_ms = 0; }
    }
  }
  out.commissions_active = out.effective_state === "MONETIZATION_ENABLED";
  return out;
}

export async function readLaunchRecord(env) {
  if (!env || !env.DB) return null;
  try {
    const row = await env.DB.prepare("SELECT value, updated_at, updated_by FROM app_settings WHERE key = ?").bind(KEY).first();
    if (!row) return null;
    const rec = parseStored(row.value);
    if (rec) rec.updated_at = row.updated_at;
    return rec;
  } catch (e) {
    return null; // table not migrated yet -> BETA
  }
}

export async function getLaunchState(env, nowMs) {
  const rec = await readLaunchRecord(env);
  return presentLaunch(rec, nowMs == null ? Date.now() : nowMs, promoDays(env));
}

/** Pure: validate a requested transition and build the new record. Throws {status,message}. */
export function planTransition(current, to, confirm, now, days) {
  const from = (current && current.state) || "BETA";
  const target = String(to || "").trim().toUpperCase();
  const fail = (msg, status) => { const e = new Error(msg); e.status = status || 400; throw e; };
  if (!LAUNCH_STATES.includes(target)) fail("Stato non valido");
  if (String(confirm || "").trim().toUpperCase() !== CONFIRM_PHRASE) fail("Per cambiare stato scrivi " + CONFIRM_PHRASE);
  if (target === from) fail("Lo stato è già " + from);
  if (!allowedTransitions(from).includes(target)) fail("Passaggio non consentito: " + from + " → " + target);
  const nowIso = new Date(now).toISOString();
  const rec = { state: target, promo_start: null, promo_end: null };
  if (target === "LAUNCH_PROMO") {
    rec.promo_start = nowIso;
    rec.promo_end = new Date(now + (days || 15) * 86400 * 1000).toISOString();
  } else if (target === "PROMO_ENDED" || target === "MONETIZATION_ENABLED") {
    rec.promo_start = (current && current.promo_start) || null;
    rec.promo_end = (current && current.promo_end) || (target === "PROMO_ENDED" ? nowIso : null);
    if (target === "PROMO_ENDED" && current && current.promo_end && Date.parse(current.promo_end) > now) rec.promo_end = nowIso;
  }
  return { from, rec };
}

export async function setLaunchState(env, admin, to, confirm, note) {
  const now = Date.now();
  const current = await readLaunchRecord(env);
  const { from, rec } = planTransition(current, to, confirm, now, promoDays(env));
  const nowIso = new Date(now).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).bind(KEY, JSON.stringify(rec), nowIso, admin.id),
    env.DB.prepare(
      `INSERT INTO launch_state_log (id, from_state, to_state, actor_id, actor_email, promo_start, promo_end, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), from, rec.state, admin.id, admin.email || null, rec.promo_start, rec.promo_end, String(note || "").slice(0, 300) || null, nowIso)
  ]);
  return presentLaunch({ ...rec, updated_at: nowIso }, now, promoDays(env));
}

export async function launchLog(env, limit) {
  try {
    const rows = await env.DB.prepare(
      "SELECT from_state, to_state, actor_email, promo_start, promo_end, note, created_at FROM launch_state_log ORDER BY created_at DESC LIMIT ?"
    ).bind(Math.min(100, Math.max(1, Number(limit) || 30))).all();
    return rows.results || [];
  } catch (e) {
    return [];
  }
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(cors || {}) }
  });
}

export async function handleLaunchRoutes(request, env, path, helpers) {
  const method = request.method.toUpperCase();
  const cors = (helpers && helpers.corsHeaders) || {};
  if (path === "stats" && method === "GET") {
    // Public, aggregate-only marketplace counters (no personal data).
    let certified = 0;
    try {
      const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM slabs WHERE status IN ('approved', 'listed') AND is_test = 0 AND is_ungraded = 0").first();
      certified = (r && r.n) || 0;
    } catch (e) { certified = 0; }
    return json({ certified }, 200, Object.assign({ "Cache-Control": "public, max-age=60" }, cors));
  }
  if (path === "launch" && method === "GET") {
    return json({ launch: await getLaunchState(env) }, 200, cors);
  }
  if (path !== "admin/launch") return null;
  try {
    const admin = await helpers.requireAdmin(request, env);
    if (method === "GET") {
      const launch = await getLaunchState(env);
      return json({ launch, allowed: allowedTransitions(launch.state), confirm_phrase: CONFIRM_PHRASE, log: await launchLog(env, 30) }, 200, cors);
    }
    if (method === "POST") {
      const body = await helpers.readJson(request).catch(() => ({}));
      const launch = await setLaunchState(env, admin, body.to, body.confirm, body.note);
      if (helpers.audit) await helpers.audit(env, admin.id, "launch_state", "app_settings", "launch_state", { to: launch.state });
      return json({ launch, allowed: allowedTransitions(launch.state), confirm_phrase: CONFIRM_PHRASE, log: await launchLog(env, 30) }, 200, cors);
    }
    return json({ error: "Metodo non consentito" }, 405, cors);
  } catch (err) {
    return json({ error: err.message || "Errore interno" }, err.status || 500, cors);
  }
}
